#!/usr/bin/env node
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
