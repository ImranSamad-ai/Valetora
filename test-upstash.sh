#!/usr/bin/env bash
# Persistence test against local mocks of Moove and Upstash.
cd "$(dirname "$0")"; rm -f /tmp/as-up.json
export MOOVE_API_BASE_URL=http://localhost:4010 MOOVE_API_KEY=mk_test VALETORA_DATA=/tmp/as-up.json VALETORA_ADMIN_TOKEN=adm VALETORA_AGENT_TOKEN=agt PORT=8793 UPSTASH_REDIS_REST_URL=http://localhost:4020 UPSTASH_REDIS_REST_TOKEN=up_test
node mock-moove.js >/dev/null 2>&1 </dev/null & M=$!
node mock-upstash.js >/dev/null 2>&1 </dev/null & U=$!
sleep 0.5
start(){ node server.js >/tmp/as-up.log 2>&1 </dev/null & S=$!; sleep 1; }
A=(-s -m 5 -H "Authorization: Bearer agt" -H "Content-Type: application/json"); D=(-s -m 5 -H "Authorization: Bearer adm" -H "Content-Type: application/json")
start
echo "health:"; curl -s -m 5 localhost:8793/health; echo
curl "${A[@]}" -X POST localhost:8793/v1/links -d '{"amount":"4","counterparty":"vercel.com"}' -o /dev/null
curl "${D[@]}" -X PUT localhost:8793/v1/policy -d '{"daily":20}' -o /dev/null
curl "${D[@]}" -X POST localhost:8793/v1/pause -o /dev/null
echo "restart server (fresh process)..."; kill $S; sleep 0.5; start
echo "after restart -> log entries / daily / paused:"; curl "${D[@]}" localhost:8793/v1/log | python3 -c "import sys,json;print(len(json.load(sys.stdin)))"; curl "${D[@]}" localhost:8793/v1/policy | python3 -c "import sys,json;p=json.load(sys.stdin);print(p['daily'],p['paused'])"
echo "no local file written (expect 'no file'):"; [ -e /tmp/as-up.json ] && echo "FILE EXISTS" || echo "no file"
curl "${D[@]}" -X POST localhost:8793/v1/resume -o /dev/null
echo "Upstash goes down mid-run -> link request (expect 503, nothing created):"; kill $U; sleep 0.5
curl -s -m 8 -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer agt" -H "Content-Type: application/json" -X POST localhost:8793/v1/links -d '{"amount":"1"}'
echo "budget unchanged (expect 16):"; curl "${A[@]}" localhost:8793/v1/budget | python3 -c "import sys,json;print(json.load(sys.stdin)['daily_remaining'])"
kill $S; sleep 0.5
echo "start with Upstash down (expect exit, FATAL):"; timeout 5 node server.js 2>&1 </dev/null | head -2
kill $M 2>/dev/null; rm -f /tmp/as-up.json
