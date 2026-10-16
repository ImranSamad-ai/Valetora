// HTTP API. Admin token: everything. Agent token: check budget + create links only.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as core from './core.js';
const ADMIN = process.env.VALETORA_ADMIN_TOKEN, AGENT = process.env.VALETORA_AGENT_TOKEN;
if (!ADMIN || !AGENT) { console.error('Set VALETORA_ADMIN_TOKEN and VALETORA_AGENT_TOKEN'); process.exit(1); }
const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const role = req => { const t = (req.headers.authorization || '').replace(/^Bearer /, ''); return eq(t, ADMIN) ? 'admin' : eq(t, AGENT) ? 'agent' : null; };
const body = req => new Promise((res, rej) => { let s = ''; req.on('data', c => { s += c; if (s.length > 16384) { rej(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } }); req.on('end', () => { try { res(s ? JSON.parse(s) : {}); } catch { rej(Object.assign(new Error('invalid JSON'), { status: 400 })); } }); });

// Throttle failed logins per client IP. Behind a proxy, the last X-Forwarded-For entry is the one the proxy added.
const fails = new Map();
const PUBLIC = process.env.VALETORA_PUBLIC_DEMO === '1'; // opt-in read-only demo at /demo
const clientIp = req => req.headers['fly-client-ip'] || (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
http.createServer(async (req, res) => {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  try {
    const { pathname: p } = new URL(req.url, 'http://x'), m = req.method;
    if (p === '/health') return send(200, { ok: true, storage: core.storage });
    if (m === 'GET' && (p === '/' || p === '/index.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'" }); return res.end(fs.readFileSync(new URL('./public/index.html', import.meta.url))); }
    if (PUBLIC && m === 'GET' && p === '/demo') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'" }); return res.end(fs.readFileSync(new URL('./public/demo.html', import.meta.url))); }
    if (PUBLIC && m === 'GET' && p === '/public/state') return send(200, core.publicState());
    if (PUBLIC && m === 'POST' && p === '/public/simulate') {
      const k = 'sim:' + clientIp(req), h = fails.get(k), live = h && Date.now() - h.t < 6e4;
      if (live && h.n >= 30) return send(429, { error: 'rate limit: 30 simulations per minute' });
      fails.set(k, { n: (live ? h.n : 0) + 1, t: live ? h.t : Date.now() });
      const b = await body(req); return send(200, core.simulate(b.counterparty, b.amount));
    }
    const k = clientIp(req), f = fails.get(k), live = f && Date.now() - f.t < 6e4;
    if (live && f.n >= 10) return send(429, { error: 'too many failed attempts, retry in a minute' });
    const r = role(req);
    if (!r) { if (fails.size > 1000) fails.clear(); fails.set(k, { n: (live ? f.n : 0) + 1, t: Date.now() }); return send(401, { error: 'unauthorized' }); }
    if (m === 'GET' && p === '/v1/budget') return send(200, core.checkBudget());
    if (m === 'POST' && p === '/v1/links') return send(200, await core.createLink(await body(req)));
    if (r !== 'admin') return send(403, { error: 'admin token required' });
    if (m === 'GET' && p === '/v1/policy') return send(200, core.getPolicy());
    if (m === 'PUT' && p === '/v1/policy') return send(200, await core.setPolicy(await body(req)));
    if (m === 'POST' && p === '/v1/pause') return send(200, await core.setPolicy({ paused: true }));
    if (m === 'POST' && p === '/v1/resume') return send(200, await core.setPolicy({ paused: false }));
    if (m === 'GET' && p === '/v1/log') return send(200, core.getLog());
    if (m === 'POST' && p === '/v1/reconcile') return send(200, await core.reconcile());
    send(404, { error: 'not found' });
  } catch (e) { send(e.status || 400, { error: e.message }); }
}).listen(process.env.PORT || 8787, () => console.error('Valetora listening on', process.env.PORT || 8787));
// Keep link status (paid/completed) fresh so the demo stats reflect real payments. 0 disables.
const RECON = Number(process.env.VALETORA_RECONCILE_MINUTES || 0);
if (RECON > 0) setInterval(() => core.reconcile().catch(e => console.error('reconcile failed:', e.message)), RECON * 6e4);
