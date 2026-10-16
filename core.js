// Valetora core: policy engine + Moove client + audit log. Zero dependencies.
import fs from 'node:fs';
const BASE = process.env.MOOVE_API_BASE_URL || 'https://api.moove.xyz';
const FILE = process.env.VALETORA_DATA || './valetora-data.json';
const DAY = 864e5, WEEK = 7 * DAY;
const DEF = { paused: false, daily: 30, weekly: 150, perTx: 10, mode: 'any', allow: [] };

// Storage: Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set, otherwise a local JSON file.
const R_URL = process.env.UPSTASH_REDIS_REST_URL, R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const R_KEY = process.env.VALETORA_REDIS_KEY || 'valetora:state';
const REMOTE = !!(R_URL && R_TOKEN);
export const storage = REMOTE ? 'upstash' : 'file';
async function redis(cmd) {
  const r = await fetch(R_URL.replace(/\/$/, ''), { method: 'POST', headers: { Authorization: 'Bearer ' + R_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'Upstash HTTP ' + r.status);
  return j.result;
}
let db = { policy: { ...DEF }, log: [] };
try {
  const raw = REMOTE ? await redis(['GET', R_KEY]) : (fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : null);
  if (raw) { const s = JSON.parse(raw); db = { policy: { ...DEF, ...s.policy }, log: s.log || [] }; }
} catch (e) {
  // With remote storage, refuse to start rather than overwrite real history with an empty state.
  if (REMOTE) { console.error('FATAL: cannot load state from Upstash:', e.message); process.exit(1); }
}
// save() resolves once the latest state is stored. Remote writes are coalesced and serialized.
let writing = null, dirty = false;
function save() {
  if (!REMOTE) { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(FILE + '.tmp', FILE); return Promise.resolve(); }
  dirty = true;
  if (!writing) writing = (async () => {
    try { while (dirty) { dirty = false; await redis(['SET', R_KEY, JSON.stringify(db)]); } }
    catch (e) { dirty = false; throw Object.assign(new Error('Storage unavailable: ' + e.message), { status: 503 }); }
    finally { writing = null; }
  })();
  return writing;
}
const soft = () => save().catch(e => console.error('save failed:', e.message));
const trim = () => { if (db.log.length > 500) db.log = db.log.filter((x, i) => i < 500 || Date.now() - x.ts < WEEK); };

// Serialize writes so concurrent agent calls can't overspend the budget.
let chain = Promise.resolve();
const lock = fn => { const r = chain.then(fn); chain = r.catch(() => {}); return r; };

const counted = e => e.status === 'approved' || e.status === 'pending';
const spent = ms => db.log.filter(e => counted(e) && Date.now() - e.ts < ms).reduce((a, e) => a + Number(e.amount), 0);
const matches = (m, list) => { m = (m || '').toLowerCase().trim(); return list.some(a => m === a || m.endsWith('.' + a)); };

export const getPolicy = () => ({ ...db.policy });
export async function setPolicy(p) {
  const n = { ...db.policy };
  for (const k of ['daily', 'weekly', 'perTx']) if (p[k] !== undefined) { const v = Number(p[k]); if (!(v >= 0)) throw new Error(k + ' must be >= 0'); n[k] = v; }
  if (p.mode !== undefined) { if (!['any', 'allow'].includes(p.mode)) throw new Error('mode must be any|allow'); n.mode = p.mode; }
  if (p.allow !== undefined) { if (!Array.isArray(p.allow)) throw new Error('allow must be an array'); n.allow = p.allow.map(s => String(s).toLowerCase().trim()).filter(Boolean); }
  if (p.paused !== undefined) n.paused = !!p.paused;
  const prev = db.policy; db.policy = n;
  try { await save(); } catch (e) { db.policy = prev; throw e; }
  return { ...n };
}

export function checkBudget() {
  const p = db.policy, d = spent(DAY), w = spent(WEEK);
  return { paused: p.paused, per_tx_max: p.perTx, daily_remaining: +Math.max(0, p.daily - d).toFixed(6), weekly_remaining: +Math.max(0, p.weekly - w).toFixed(6), merchant_mode: p.mode, allow_list: p.allow, window: 'rolling 24h / 7d' };
}

function evaluate(counterparty, amt) {
  const p = db.policy;
  if (p.paused) return ['Spending is paused by the owner', 'global_pause'];
  if (amt > p.perTx) return [`Exceeds per-transaction max of ${p.perTx}`, 'per_tx_max'];
  if (p.mode === 'allow' && !matches(counterparty, p.allow)) return ['Counterparty not on allow-list', 'allow_list'];
  if (spent(DAY) + amt > p.daily) return [`Would exceed daily limit (${Math.max(0, p.daily - spent(DAY)).toFixed(2)} left)`, 'daily_limit'];
  if (spent(WEEK) + amt > p.weekly) return [`Would exceed weekly limit (${Math.max(0, p.weekly - spent(WEEK)).toFixed(2)} left)`, 'weekly_limit'];
  return null;
}

// Moove API: 409 / 4xx are not retried; 429 and 5xx retry with backoff (per Moove docs).
async function moove(method, path, body) {
  if (!process.env.MOOVE_API_KEY) throw Object.assign(new Error('MOOVE_API_KEY not set'), { status: 500 });
  for (let i = 0; ; i++) {
    const r = await fetch(BASE + path, { method, headers: { 'X-API-Key': process.env.MOOVE_API_KEY, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    if ((r.status === 429 || r.status >= 500) && i < 3) { await new Promise(s => setTimeout(s, 500 * 2 ** i)); continue; }
    throw Object.assign(new Error(j.errors?.[0]?.message || 'Moove HTTP ' + r.status), { status: r.status });
  }
}

export function createLink({ agent = 'agent', counterparty = '', amount, kind = 'one-time', description = '', expiresInMinutes }) {
  return lock(async () => {
    const amt = Number(amount);
    if (!/^\d+(\.\d+)?$/.test(String(amount)) || !(amt > 0)) throw Object.assign(new Error('amount must be a positive decimal'), { status: 422 });
    if (!['one-time', 'multi-use'].includes(kind)) throw Object.assign(new Error('kind must be one-time|multi-use'), { status: 422 });
    const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), agent: String(agent).slice(0, 60), counterparty: String(counterparty).slice(0, 120), amount: String(amount), kind };
    const v = evaluate(counterparty, amt);
    if (v) { Object.assign(e, { status: 'blocked', reason: v[0], policy: v[1] }); db.log.unshift(e); trim(); await soft(); return { ok: false, reason: v[0], policy: v[1], ...checkBudget() }; }
    Object.assign(e, { status: 'pending', policy: 'all_policies_passed' }); db.log.unshift(e); trim();
    try { await save(); } catch (err) { db.log = db.log.filter(x => x !== e); throw err; } // reserve budget durably first
    try {
      const body = { toAmount: String(amount), description: `${description} [valetora:${e.agent}:${e.id}]`.trim().slice(0, 500) };
      if (kind === 'one-time') body.maxUsage = 1;
      if (expiresInMinutes > 0) body.expirationDate = new Date(Date.now() + expiresInMinutes * 6e4).toISOString();
      const r = await moove('POST', '/v1/payment-link', body);
      Object.assign(e, { status: 'approved', linkId: r.id, url: r.url }); await soft();
      return { ok: true, id: e.id, url: r.url, link_id: r.id, ...checkBudget() };
    } catch (err) {
      Object.assign(e, { status: 'error', reason: err.message }); await soft(); // released from budget
      return { ok: false, reason: 'Moove error: ' + err.message, policy: 'moove_error' };
    }
  });
}

// Pull link status from Moove (GET /v1/payment-link is the reconcile endpoint).
export function reconcile() {
  return lock(async () => {
    let offset = 0, n = 0;
    for (let page = 0; page < 20 && offset != null; page++) {
      const r = await moove('GET', '/v1/payment-link?offset=' + offset);
      for (const l of r.data) { const e = db.log.find(x => x.linkId === l.id); if (e) { e.mooveStatus = l.status; e.receivedAmount = l.receivedAmount; n++; } }
      offset = r.nextOffset ?? null;
    }
    await soft(); return { updated: n };
  });
}
export const getLog = (limit = 100) => db.log.slice(0, limit);

// ---- Public read-only demo (enabled by VALETORA_PUBLIC_DEMO=1 in server.js) ----
// Never exposes ids, tokens or anything that grants control. simulate() records nothing and never calls Moove.
export function publicState() {
  const L = db.log, p = db.policy;
  return {
    policy: { paused: p.paused, daily: p.daily, weekly: p.weekly, perTx: p.perTx, mode: p.mode, allow: p.allow },
    budget: checkBudget(),
    stats: { links_created: L.filter(e => e.status === 'approved').length, links_paid: L.filter(e => e.mooveStatus === 'completed' || Number(e.receivedAmount) > 0).length, blocked: L.filter(e => e.status === 'blocked').length, agents: new Set(L.map(e => e.agent)).size },
    log: L.slice(0, 50).map(({ ts, agent, counterparty, amount, kind, status, policy, reason, url, mooveStatus, receivedAmount }) => ({ ts, agent, counterparty, amount, kind, status, policy, reason, url, mooveStatus, receivedAmount })),
  };
}
export function simulate(counterparty, amount) {
  const amt = Number(amount);
  if (!/^\d+(\.\d+)?$/.test(String(amount)) || !(amt > 0)) throw Object.assign(new Error('amount must be a positive decimal'), { status: 422 });
  const v = evaluate(String(counterparty || '').slice(0, 120), amt);
  return v ? { ok: false, simulated: true, reason: v[0], policy: v[1] } : { ok: true, simulated: true, policy: 'all_policies_passed', note: 'Would be approved. No link created.' };
}
