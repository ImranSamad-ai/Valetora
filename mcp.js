// MCP stdio server (JSON-RPC over newline-delimited stdin/stdout). Zero dependencies.
// Agents get create_payment_link + check_budget only. They cannot pause, resume, or edit policy.
import readline from 'node:readline';
import * as core from './core.js';
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
