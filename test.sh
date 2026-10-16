#!/usr/bin/env bash
# Smoke test against a local mock of the Moove API.
set -u; cd "$(dirname "$0")"; rm -f /tmp/as-test.json
node mock-moove.js & M=$!
MOOVE_API_BASE_URL=http://localhost:4010 MOOVE_API_KEY=mk_test VALETORA_DATA=/tmp/as-test.json VALETORA_ADMIN_TOKEN=adm VALETORA_AGENT_TOKEN=agt PORT=8788 node server.js 2>/dev/null & S=$!
sleep 1; H=(-s -H "Content-Type: application/json"); A="Authorization: Bearer agt"; D="Authorization: Bearer adm"
L(){ curl "${H[@]}" -H "$A" -X POST localhost:8788/v1/links -d "$1"; echo; }
echo "1 approve:";   L '{"amount":"5","counterparty":"vercel.com"}'
echo "2 per-tx block:"; L '{"amount":"50"}'
echo "3 pause:";     curl "${H[@]}" -H "$D" -X POST localhost:8788/v1/pause; echo; L '{"amount":"1"}'
echo "4 agent cannot resume:"; curl "${H[@]}" -H "$A" -X POST localhost:8788/v1/resume; echo
curl "${H[@]}" -H "$D" -X POST localhost:8788/v1/resume >/dev/null
echo "5 allow-list:"; curl "${H[@]}" -H "$D" -X PUT localhost:8788/v1/policy -d '{"mode":"allow","allow":["vercel.com"]}' >/dev/null; L '{"amount":"2","counterparty":"evil.io"}'; L '{"amount":"2","counterparty":"app.vercel.com"}'
echo "6 daily limit:"; curl "${H[@]}" -H "$D" -X PUT localhost:8788/v1/policy -d '{"mode":"any","daily":8}' >/dev/null; L '{"amount":"2"}'
echo "7 mcp:"; printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"check_budget"}}' | MOOVE_API_KEY=mk_test VALETORA_DATA=/tmp/as-test.json timeout 2 node mcp.js | cut -c1-200
echo "8 unauth:"; curl -s -o /dev/null -w "%{http_code}\n" localhost:8788/v1/budget
kill $S $M 2>/dev/null
