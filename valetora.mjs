#!/usr/bin/env node
// Valetora: single-file build (server + policy engine + dashboard + demo page + MCP tool + demo agent).
// Requires Node 20+. No dependencies. This file is generated from the multi-file project.
//
//   node valetora.mjs            start the server (dashboard at /, reviewer demo at /demo if VALETORA_PUBLIC_DEMO=1)
//   node valetora.mjs agent      run the scripted demo agent (flags: --once --burn --delay <ms>)
//   node valetora.mjs mcp        run the MCP tool server over stdio for AI agents
//
// Required env for the server: MOOVE_API_KEY, VALETORA_ADMIN_TOKEN, VALETORA_AGENT_TOKEN.
// Optional: VALETORA_PUBLIC_DEMO=1, VALETORA_RECONCILE_MINUTES=10, PORT,
//           UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (keep the log on hosts without a disk),
//           VALETORA_DATA (JSON file path when not using Upstash).
// For agent/mcp modes: VALETORA_URL and VALETORA_AGENT_TOKEN (mcp can also run standalone with MOOVE_API_KEY).
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline';

// ===== Embedded pages =====
const INDEX_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Valetora</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--tx:#14171f;--mu:#667085;--bd:#e3e6ec;--ac:#4f46e5;--ok:#12805c;--no:#c0362c;color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1118;--card:#171b25;--tx:#eef0f5;--mu:#97a0b3;--bd:#282e3c;--ac:#8b86ff;--ok:#3ecf9a;--no:#ff7b70;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0e1118;--card:#171b25;--tx:#eef0f5;--mu:#97a0b3;--bd:#282e3c;--ac:#8b86ff;--ok:#3ecf9a;--no:#ff7b70;color-scheme:dark}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px;display:grid;gap:14px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.05em;color:var(--mu)}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.sub{color:var(--mu);font-size:13px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
label{display:block;font-size:12px;color:var(--mu);margin-bottom:3px}
input,select{width:100%;padding:9px 10px;border:1px solid var(--bd);border-radius:9px;background:var(--bg);color:var(--tx);font:inherit}
button{padding:10px 14px;border:0;border-radius:9px;background:var(--ac);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--mu);border:1px solid var(--bd)}
button.pause{background:var(--no)}button.resume{background:var(--ok)}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600}
.on{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}.off{background:color-mix(in srgb,var(--no) 18%,transparent);color:var(--no)}
.bar{height:8px;border-radius:9px;background:var(--bd);overflow:hidden;margin:4px 0 10px}.bar i{display:block;height:100%;background:var(--ac)}
.log{display:grid;gap:8px}.it{border:1px solid var(--bd);border-radius:10px;padding:10px;font-size:13px;word-break:break-word}
.it b{font-size:14px}.mu{color:var(--mu)}
pre{margin:0;padding:10px;border-radius:9px;background:var(--bg);overflow-x:auto;font-size:12px}
.stack{display:grid;gap:10px}
.err{color:var(--no);font-size:13px;min-height:1em}a{color:var(--ac)}#app{display:none}</style></head><body><main>
<div class="top"><div><h1>🛡️ Valetora</h1><div class="sub" id="who">Policy-controlled spending for AI agents</div></div><span><span id="st" class="pill on" style="display:none"></span> <button class="ghost" id="out" style="display:none">Sign out</button></span></div>
<div class="err" id="err"></div>

<section class="card stack" id="login"><h2>Sign in</h2><div class="sub">Enter the owner token (VALETORA_ADMIN_TOKEN). It stays in this tab only.</div>
<input id="tok" type="password" placeholder="Admin token" autocomplete="off"><button id="in">Sign in</button></section>

<div id="app" style="gap:14px">
<button id="pz"></button>
<section class="card stack"><h2>Policy engine</h2>
<div class="row"><div><label>Daily limit</label><input id="daily" type="number" min="0" step="any"></div><div><label>Weekly limit</label><input id="weekly" type="number" min="0" step="any"></div></div>
<div class="row"><div><label>Per-link max</label><input id="perTx" type="number" min="0" step="any"></div><div><label>Counterparty rule</label><select id="mode"><option value="any">Any</option><option value="allow">Allow-list only</option></select></div></div>
<div><label>Allow-list (comma-separated domains)</label><input id="allow" placeholder="vercel.com, openai.com"></div>
<button id="save">Save policy</button><div class="sub">Amounts are in your Moove settlement token. Settlement token, chain and wallet are managed in your Moove account.</div></section>

<section class="card"><h2>Budget (rolling windows)</h2>
<div class="sub" id="mDay"></div><div class="bar"><i id="bDay"></i></div>
<div class="sub" id="mWk"></div><div class="bar"><i id="bWk"></i></div></section>

<section class="card stack"><h2>Test a request</h2>
<div class="row"><div><label>Counterparty</label><input id="cp" value="vercel.com"></div><div><label>Amount</label><input id="amt" type="number" min="0" step="any" value="5"></div></div>
<div class="row"><div><label>Type</label><select id="kind"><option value="one-time">One-time</option><option value="multi-use">Multi-use</option></select></div><div><label>Description</label><input id="desc" value="Test link"></div></div>
<button id="go">Create payment link (real Moove call)</button><div class="sub" id="res"></div></section>

<section class="card"><div class="top"><h2 style="margin:0">Audit log</h2><span><button class="ghost" id="rec">Reconcile</button> <button class="ghost" id="csv">CSV</button></span></div><div class="log" id="log" style="margin-top:10px"></div></section>
</div></main>
<script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const m2=n=>(+n).toFixed(2);
let T='',P=null,B=null,L=[],filled=false;
try{T=sessionStorage.getItem('as_t')||''}catch(e){}
function show(){$('login').style.display=T?'none':'grid';$('app').style.display=T?'grid':'none';$('out').style.display=T?'':'none';$('st').style.display=T?'':'none'}
function signout(){T='';filled=false;try{sessionStorage.removeItem('as_t')}catch(e){}show()}
async function api(m,p,b){
 const r=await fetch(p,{method:m,headers:{Authorization:'Bearer '+T,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});
 const j=await r.json().catch(()=>({}));
 if(r.status===401){signout();throw new Error('Wrong or missing token')}
 if(!r.ok)throw new Error(j.error||'HTTP '+r.status);return j}
async function refresh(){
 if(!T)return;
 try{[P,B,L]=await Promise.all([api('GET','/v1/policy'),api('GET','/v1/budget'),api('GET','/v1/log')]);$('err').textContent='';render()}
 catch(e){$('err').textContent=e.message}}
function render(){
 if(!filled){['daily','weekly','perTx','mode'].forEach(k=>$(k).value=P[k]);$('allow').value=P.allow.join(', ');filled=true}
 $('st').className='pill '+(P.paused?'off':'on');$('st').textContent=P.paused?'Paused':'Active';
 $('pz').className=P.paused?'resume':'pause';$('pz').textContent=P.paused?'▶ Resume all agent spending':'⏸ Pause all agent spending';
 const d=P.daily-B.daily_remaining,w=P.weekly-B.weekly_remaining;
 $('mDay').textContent='Last 24h: '+m2(d)+' of '+m2(P.daily);$('bDay').style.width=Math.min(100,P.daily?d/P.daily*100:0)+'%';
 $('mWk').textContent='Last 7 days: '+m2(w)+' of '+m2(P.weekly);$('bWk').style.width=Math.min(100,P.weekly?w/P.weekly*100:0)+'%';
 const h=L.map(l=>/\\/@([^/]+)\\/pay\\//.exec(l.url||'')).find(Boolean);
 $('who').textContent=h?'Connected as @'+h[1]:'Policy-controlled spending for AI agents';
 const col={approved:'ok',pending:'ok',blocked:'no',error:'no'};
 $('log').innerHTML=L.length?L.slice(0,50).map(l=>\`<div class="it"><b style="color:var(--\${col[l.status]||'mu'})">\${esc(l.status.toUpperCase())}</b> · \${esc(l.amount)} · \${esc(l.counterparty||'—')}
<div class="mu">\${esc(l.agent)} · \${esc(l.kind)} · \${new Date(l.ts).toLocaleString()}</div>
<div class="mu">Policy: \${esc(l.policy)}\${l.reason?' — '+esc(l.reason):''}\${l.mooveStatus?' · Moove: '+esc(l.mooveStatus)+(l.receivedAmount?' ('+esc(l.receivedAmount)+' received)':''):''}</div>
\${/^https:\\/\\//.test(l.url||'')?\`<div><a href="\${esc(l.url)}" target="_blank" rel="noopener noreferrer">\${esc(l.url)}</a></div>\`:''}</div>\`).join(''):'<div class="sub">No requests yet.</div>'}
async function act(fn){try{await fn();await refresh()}catch(e){$('err').textContent=e.message}}
$('in').onclick=()=>{T=$('tok').value.trim();try{sessionStorage.setItem('as_t',T)}catch(e){}$('tok').value='';show();refresh()};
$('out').onclick=signout;
$('pz').onclick=()=>act(()=>api('POST',P.paused?'/v1/resume':'/v1/pause'));
$('save').onclick=()=>act(async()=>{P=await api('PUT','/v1/policy',{daily:+$('daily').value,weekly:+$('weekly').value,perTx:+$('perTx').value,mode:$('mode').value,allow:$('allow').value.split(',')});filled=false});
$('go').onclick=()=>act(async()=>{$('res').textContent='Working…';const r=await api('POST','/v1/links',{agent:'dashboard',counterparty:$('cp').value,amount:$('amt').value,kind:$('kind').value,description:$('desc').value});
 $('res').style.color=r.ok?'var(--ok)':'var(--no)';$('res').textContent=r.ok?'Approved → '+r.url:'Blocked: '+r.reason});
$('rec').onclick=()=>act(async()=>{const r=await api('POST','/v1/reconcile');$('res').style.color='var(--mu)';$('res').textContent='Reconciled '+r.updated+' links'});
$('csv').onclick=()=>{const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 const t=['time,agent,counterparty,amount,type,status,policy,reason,url,moove_status',...L.map(l=>[new Date(l.ts).toISOString(),l.agent,l.counterparty,l.amount,l.kind,l.status,l.policy,l.reason,l.url,l.mooveStatus].map(q).join(','))].join('\\n');
 const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:'text/csv'}));a.download='valetora-audit.csv';a.click()};
show();refresh();setInterval(refresh,10000);
</script></body></html>
`;
const DEMO_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Valetora</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--tx:#14171f;--mu:#667085;--bd:#e3e6ec;--ac:#4f46e5;--ok:#12805c;--no:#c0362c;color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1118;--card:#171b25;--tx:#eef0f5;--mu:#97a0b3;--bd:#282e3c;--ac:#8b86ff;--ok:#3ecf9a;--no:#ff7b70;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0e1118;--card:#171b25;--tx:#eef0f5;--mu:#97a0b3;--bd:#282e3c;--ac:#8b86ff;--ok:#3ecf9a;--no:#ff7b70;color-scheme:dark}
html{scroll-padding-top:env(safe-area-inset-top,0px)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px;display:grid;gap:14px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px}
h1{font-size:20px;margin:0}h2{font-size:14px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.05em;color:var(--mu)}
.top{display:flex;justify-content:space-between;align-items:center;gap:10px}
.sub{color:var(--mu);font-size:13px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
label{display:block;font-size:12px;color:var(--mu);margin-bottom:3px}
input,select{width:100%;padding:9px 10px;border:1px solid var(--bd);border-radius:9px;background:var(--bg);color:var(--tx);font:inherit}
button{padding:10px 14px;border:0;border-radius:9px;background:var(--ac);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--mu);border:1px solid var(--bd)}
button.pause{background:var(--no)}button.resume{background:var(--ok)}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600}
.on{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}.off{background:color-mix(in srgb,var(--no) 18%,transparent);color:var(--no)}
.bar{height:8px;border-radius:9px;background:var(--bd);overflow:hidden;margin:4px 0 10px}.bar i{display:block;height:100%;background:var(--ac)}
.log{display:grid;gap:8px}.it{border:1px solid var(--bd);border-radius:10px;padding:10px;font-size:13px;word-break:break-word}
.it b{font-size:14px}.mu{color:var(--mu)}
pre{margin:0;padding:10px;border-radius:9px;background:var(--bg);overflow-x:auto;font-size:12px}
.stack{display:grid;gap:10px}
.err{color:var(--no);font-size:13px;min-height:1em}a{color:var(--ac)}#app{display:none}.ban{border-color:var(--ac)}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center}.stats b{display:block;font-size:20px}</style></head><body><main>
<div class="top"><div><h1>🛡️ Valetora</h1><div class="sub">Live, read-only demo</div></div><span id="st" class="pill on">Active</span></div>
<div class="card ban"><div class="sub">You are viewing a live system. Entries below are real payment links created by agents under the policy shown. You cannot change anything here. The simulator only asks the policy engine "would this be allowed?" and creates nothing.</div></div>
<div class="err" id="err"></div>
<section class="card stats"><div><b id="s1">–</b><span class="sub">links created</span></div><div><b id="s2">–</b><span class="sub">paid</span></div><div><b id="s3">–</b><span class="sub">blocked</span></div><div><b id="s4">–</b><span class="sub">agents</span></div></section>
<section class="card"><h2>Active policy</h2><div id="pol" class="sub"></div></section>
<section class="card"><h2>Budget (rolling windows)</h2><div class="sub" id="mDay"></div><div class="bar"><i id="bDay"></i></div><div class="sub" id="mWk"></div><div class="bar"><i id="bWk"></i></div></section>
<section class="card stack"><h2>Try the policy engine</h2>
<div class="row"><div><label>Counterparty</label><input id="cp" value="vercel.com"></div><div><label>Amount</label><input id="amt" type="number" min="0" step="any" value="5"></div></div>
<button id="go">Simulate request</button><div class="sub" id="res"></div></section>
<section class="card"><h2>Audit log</h2><div class="log" id="log"></div></section>
</main><script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const m2=n=>(+n).toFixed(2);
async function refresh(){
 try{const r=await fetch('/public/state');if(!r.ok)throw new Error('Demo unavailable');const s=await r.json(),p=s.policy,b=s.budget;$('err').textContent='';
  $('st').className='pill '+(p.paused?'off':'on');$('st').textContent=p.paused?'Paused':'Active';
  $('s1').textContent=s.stats.links_created;$('s2').textContent=s.stats.links_paid;$('s3').textContent=s.stats.blocked;$('s4').textContent=s.stats.agents;
  $('pol').textContent='Daily '+m2(p.daily)+' · Weekly '+m2(p.weekly)+' · Max per link '+m2(p.perTx)+' · '+(p.mode==='allow'?'Allow-list: '+(p.allow.join(', ')||'(empty)'):'Any counterparty');
  const d=p.daily-b.daily_remaining,w=p.weekly-b.weekly_remaining;
  $('mDay').textContent='Last 24h: '+m2(d)+' of '+m2(p.daily);$('bDay').style.width=Math.min(100,p.daily?d/p.daily*100:0)+'%';
  $('mWk').textContent='Last 7 days: '+m2(w)+' of '+m2(p.weekly);$('bWk').style.width=Math.min(100,p.weekly?w/p.weekly*100:0)+'%';
  const col={approved:'ok',pending:'ok',blocked:'no',error:'no'};
  $('log').innerHTML=s.log.length?s.log.map(l=>\`<div class="it"><b style="color:var(--\${col[l.status]||'mu'})">\${esc(l.status.toUpperCase())}</b> · \${esc(l.amount)} · \${esc(l.counterparty||'—')}
<div class="mu">\${esc(l.agent)} · \${esc(l.kind)} · \${new Date(l.ts).toLocaleString()}</div>
<div class="mu">Policy: \${esc(l.policy)}\${l.reason?' — '+esc(l.reason):''}\${l.mooveStatus?' · Moove: '+esc(l.mooveStatus)+(l.receivedAmount?' ('+esc(l.receivedAmount)+' received)':''):''}</div>
\${/^https:\\/\\//.test(l.url||'')?\`<div><a href="\${esc(l.url)}" target="_blank" rel="noopener noreferrer">\${esc(l.url)}</a></div>\`:''}</div>\`).join(''):'<div class="sub">No requests yet.</div>'}
 catch(e){$('err').textContent=e.message}}
$('go').onclick=async()=>{try{const r=await fetch('/public/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({counterparty:$('cp').value,amount:$('amt').value})});const j=await r.json();
 $('res').style.color=j.ok?'var(--ok)':'var(--no)';$('res').textContent=r.ok?(j.ok?'Would be approved (simulated, nothing created)':'Would be blocked: '+j.reason):(j.error||'Error')}catch(e){$('res').textContent=e.message}};
refresh();setInterval(refresh,10000);
</script></body></html>
`;

// ===== Policy engine, Moove client, storage =====
async function makeCore() {
// Valetora core: policy engine + Moove client + audit log. Zero dependencies.
const BASE = process.env.MOOVE_API_BASE_URL || 'https://api.moove.xyz';
const FILE = process.env.VALETORA_DATA || './valetora-data.json';
const DAY = 864e5, WEEK = 7 * DAY;
const DEF = { paused: false, daily: 30, weekly: 150, perTx: 10, mode: 'any', allow: [] };

// Storage: Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set, otherwise a local JSON file.
const R_URL = process.env.UPSTASH_REDIS_REST_URL, R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const R_KEY = process.env.VALETORA_REDIS_KEY || 'valetora:state';
const REMOTE = !!(R_URL && R_TOKEN);
const storage = REMOTE ? 'upstash' : 'file';
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

const getPolicy = () => ({ ...db.policy });
async function setPolicy(p) {
  const n = { ...db.policy };
  for (const k of ['daily', 'weekly', 'perTx']) if (p[k] !== undefined) { const v = Number(p[k]); if (!(v >= 0)) throw new Error(k + ' must be >= 0'); n[k] = v; }
  if (p.mode !== undefined) { if (!['any', 'allow'].includes(p.mode)) throw new Error('mode must be any|allow'); n.mode = p.mode; }
  if (p.allow !== undefined) { if (!Array.isArray(p.allow)) throw new Error('allow must be an array'); n.allow = p.allow.map(s => String(s).toLowerCase().trim()).filter(Boolean); }
  if (p.paused !== undefined) n.paused = !!p.paused;
  const prev = db.policy; db.policy = n;
  try { await save(); } catch (e) { db.policy = prev; throw e; }
  return { ...n };
}

function checkBudget() {
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

function createLink({ agent = 'agent', counterparty = '', amount, kind = 'one-time', description = '', expiresInMinutes }) {
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
function reconcile() {
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
const getLog = (limit = 100) => db.log.slice(0, limit);

// ---- Public read-only demo (enabled by VALETORA_PUBLIC_DEMO=1 in server.js) ----
// Never exposes ids, tokens or anything that grants control. simulate() records nothing and never calls Moove.
function publicState() {
  const L = db.log, p = db.policy;
  return {
    policy: { paused: p.paused, daily: p.daily, weekly: p.weekly, perTx: p.perTx, mode: p.mode, allow: p.allow },
    budget: checkBudget(),
    stats: { links_created: L.filter(e => e.status === 'approved').length, links_paid: L.filter(e => e.mooveStatus === 'completed' || Number(e.receivedAmount) > 0).length, blocked: L.filter(e => e.status === 'blocked').length, agents: new Set(L.map(e => e.agent)).size },
    log: L.slice(0, 50).map(({ ts, agent, counterparty, amount, kind, status, policy, reason, url, mooveStatus, receivedAmount }) => ({ ts, agent, counterparty, amount, kind, status, policy, reason, url, mooveStatus, receivedAmount })),
  };
}
function simulate(counterparty, amount) {
  const amt = Number(amount);
  if (!/^\d+(\.\d+)?$/.test(String(amount)) || !(amt > 0)) throw Object.assign(new Error('amount must be a positive decimal'), { status: 422 });
  const v = evaluate(String(counterparty || '').slice(0, 120), amt);
  return v ? { ok: false, simulated: true, reason: v[0], policy: v[1] } : { ok: true, simulated: true, policy: 'all_policies_passed', note: 'Would be approved. No link created.' };
}

return { getPolicy, setPolicy, checkBudget, createLink, reconcile, getLog, publicState, simulate, storage };
}

// ===== HTTP server =====
function runServer(core) {
// HTTP API. Admin token: everything. Agent token: check budget + create links only.
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
    if (m === 'GET' && (p === '/' || p === '/index.html')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'" }); return res.end(INDEX_HTML); }
    if (PUBLIC && m === 'GET' && p === '/demo') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'" }); return res.end(DEMO_HTML); }
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

}

// ===== MCP tool server =====
function runMcp(core) {
// MCP stdio server (JSON-RPC over newline-delimited stdin/stdout). Zero dependencies.
// Agents get create_payment_link + check_budget only. They cannot pause, resume, or edit policy.
const tools = [
  { name: 'check_budget', description: 'Remaining daily/weekly budget, per-transaction max and pause state. Call before creating a link.', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_payment_link', description: 'Create a Moove payment link, subject to the owner\'s spending policy. Returns ok:false with a reason if a policy blocks it. Links settle to the owner\'s wallet.',
    inputSchema: { type: 'object', required: ['amount'], properties: { amount: { type: 'string', description: 'Decimal string in the owner\'s settlement token, e.g. "12.50"' }, counterparty: { type: 'string', description: 'Merchant or domain this is for, e.g. "vercel.com"' }, description: { type: 'string', description: 'Shown to the payer (max ~450 chars)' }, kind: { type: 'string', enum: ['one-time', 'multi-use'] }, expires_in_minutes: { type: 'integer', minimum: 1 } } } },
];
// If VALETORA_URL is set, proxy to the HTTP server so the dashboard's pause/policy apply to this agent.
const URL_ = process.env.VALETORA_URL, TOK = process.env.VALETORA_AGENT_TOKEN;
const call = (m, p, b) => fetch(URL_ + p, { method: m, headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }).then(r => r.json());
const out = o => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // notifications
  try {
    if (m.method === 'initialize') return out({ id: m.id, result: { protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'valetora', version: '0.1.0' } } });
    if (m.method === 'ping') return out({ id: m.id, result: {} });
    if (m.method === 'tools/list') return out({ id: m.id, result: { tools } });
    if (m.method === 'tools/call') {
      const { name, arguments: a = {} } = m.params;
      let r;
      const payload = { agent: process.env.VALETORA_AGENT_NAME || 'mcp-agent', counterparty: a.counterparty, amount: a.amount, kind: a.kind, description: a.description, expiresInMinutes: a.expires_in_minutes };
      if (name === 'check_budget') r = URL_ ? await call('GET', '/v1/budget') : core.checkBudget();
      else if (name === 'create_payment_link') r = URL_ ? await call('POST', '/v1/links', payload) : await core.createLink(payload);
      else return out({ id: m.id, error: { code: -32602, message: 'Unknown tool' } });
      if (r.error) throw new Error(r.error);
      return out({ id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(r) }], isError: r.ok === false && r.policy === 'moove_error' } });
    }
    out({ id: m.id, error: { code: -32601, message: 'Method not found' } });
  } catch (e) { out({ id: m.id, result: { content: [{ type: 'text', text: e.message }], isError: true } }); }
});

}

// ===== Scripted demo agent =====
function runAgent() {
// Scripted demo agent: calls the Valetora API the way a real agent would. Zero dependencies.
//   VALETORA_URL=https://<app>.fly.dev VALETORA_AGENT_TOKEN=... node demo-agent.js
// Flags: --once (one request, e.g. to show a pause)  --burn (keep going until the daily limit blocks)  --delay <ms> (default 1500)
const BASE = (process.env.VALETORA_URL || 'http://localhost:8787').replace(/\/$/, '');
const TOKEN = process.env.VALETORA_AGENT_TOKEN;
if (!TOKEN) { console.error('Set VALETORA_AGENT_TOKEN (and VALETORA_URL)'); process.exit(1); }
const args = process.argv.slice(2), has = f => args.includes('--' + f);
const di = args.indexOf('--delay'), DELAY = di >= 0 ? Number(args[di + 1]) || 0 : 1500;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
async function request(agent, counterparty, amount, description) {
  const r = await call('POST', '/v1/links', { agent, counterparty, amount: String(amount), description, kind: 'one-time' });
  console.log(r.ok ? `  ✓ ${agent}: ${amount} for ${counterparty}\n    ${r.url}` : `  ✕ ${agent}: ${amount} for ${counterparty}\n    blocked (${r.policy}): ${r.reason}`);
  await sleep(DELAY);
  return r;
}
const show = b => console.log(`  paused: ${b.paused} | per-link max: ${b.per_tx_max} | daily left: ${b.daily_remaining} | weekly left: ${b.weekly_remaining}`);

(async () => {
  console.log('Checking budget before acting…');
  const b = await call('GET', '/v1/budget'); show(b); await sleep(DELAY);
  if (has('once')) { await request('demo-bot', 'vercel.com', 1, 'Single request'); return; }

  console.log('\nNormal work:');
  await request('research-bot', 'openai.com', 1.5, 'API credits top-up');
  await request('deploy-bot', 'vercel.com', 2, 'Hosting invoice');
  await request('research-bot', 'anthropic.com', 0.75, 'API usage');

  console.log('\nTrying more than the per-link max (an honest agent reports the block and stops):');
  await request('deploy-bot', 'vercel.com', b.per_tx_max + 1, 'Annual plan');

  console.log('\nUnfamiliar counterparty (blocked only if the owner enabled the allow-list):');
  await request('research-bot', 'new-vendor.example', 1, 'Unknown vendor');

  if (has('burn')) {
    console.log('\nSpending until the daily limit stops it:');
    for (let i = 0; i < 15; i++) if (!(await request('burn-bot', 'vercel.com', Math.min(5, b.per_tx_max || 5), 'Load test ' + (i + 1))).ok) break;
  }
  console.log('\nBudget after:'); show(await call('GET', '/v1/budget'));
})().catch(e => { console.error('Error:', e.message); process.exit(1); });

}

// ===== Entry point =====
const mode = process.argv[2];
if (mode === 'agent') runAgent();
else if (mode === 'mcp') runMcp(process.env.VALETORA_URL ? null : await makeCore());
else runServer(await makeCore());
