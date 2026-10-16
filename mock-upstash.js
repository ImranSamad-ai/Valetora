// Tiny in-memory stand-in for Upstash's REST API (POST a JSON command array to the root). For tests only.
import http from 'node:http';
const kv = new Map();
http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
  const out = (c, o) => { s.writeHead(c, { 'Content-Type': 'application/json' }); s.end(JSON.stringify(o)); };
  if (q.headers.authorization !== 'Bearer up_test') return out(401, { error: 'Unauthorized' });
  let cmd; try { cmd = JSON.parse(b); } catch { return out(400, { error: 'ERR invalid body' }); }
  const [op, k, v] = cmd;
  if (op === 'SET') { kv.set(k, v); return out(200, { result: 'OK' }); }
  if (op === 'GET') return out(200, { result: kv.has(k) ? kv.get(k) : null });
  out(400, { error: 'ERR unknown command' });
}); }).listen(4020);
