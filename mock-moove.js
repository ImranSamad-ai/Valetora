import http from 'node:http';
http.createServer((q, s) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { if (q.headers['x-api-key'] !== 'mk_test') { s.writeHead(401, { 'Content-Type': 'application/json' }); return s.end('{"errors":[{"message":"bad key","code":"unauthorized"}]}'); }
  s.writeHead(200, { 'Content-Type': 'application/json' }); const id = crypto.randomUUID();
  s.end(q.method === 'POST' ? JSON.stringify({ id, url: 'https://www.moove.xyz/@test/pay/' + id }) : JSON.stringify({ data: [], limit: 10, offset: 0, nextOffset: null })); }); }).listen(4010);
