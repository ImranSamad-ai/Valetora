# Valetora backend (MVP)

Policy-gated Moove payment links for AI agents. Zero dependencies, Node 20+.

## Run
```bash
export MOOVE_API_KEY=mk_live_...          # scoped: payment_link:create, payment_link:read
export VALETORA_ADMIN_TOKEN=$(openssl rand -hex 24)   # owner: policy, pause, log
export VALETORA_AGENT_TOKEN=$(openssl rand -hex 24)   # agents: check budget + create links only
node server.js                            # HTTP API on :8787
```
Your Moove account needs a claimed Handle and a default wallet with a settlement token, otherwise Moove returns 409.

## MCP (Claude Code / Cursor)
```json
{"mcpServers":{"valetora":{"command":"node","args":["/path/to/mcp.js"],
 "env":{"VALETORA_URL":"http://localhost:8787","VALETORA_AGENT_TOKEN":"<agent token>","VALETORA_AGENT_NAME":"claude-code"}}}}
```
Tools: `check_budget`, `create_payment_link`. Agents cannot pause, resume or edit policy.
With `VALETORA_URL` set, the MCP server proxies to `server.js`, so the dashboard's pause and policy apply instantly and the Moove key stays on the server. Without it, MCP runs standalone and needs `MOOVE_API_KEY` plus its own data file (do not share a data file with `server.js`).

## Deploy
Needs one always-on instance with a small persistent volume at `/data` (the audit log lives there). Do not run more than one instance.

**Fly.io**
```bash
# edit app name in fly.toml, then:
fly launch --no-deploy --copy-config
fly volumes create valetora_data --size 1
fly secrets set MOOVE_API_KEY=mk_live_... VALETORA_ADMIN_TOKEN=$(openssl rand -hex 24) VALETORA_AGENT_TOKEN=$(openssl rand -hex 24)
fly deploy
```
**Render:** push to GitHub, then New > Blueprint and pick the repo (it reads `render.yaml`). Paste your Moove key when asked. Read the generated admin and agent tokens under Dashboard > service > Environment. On the free plan there is no persistent disk and the service sleeps after 15 idle minutes, so the audit log is lost whenever it sleeps, restarts or redeploys. Use a paid plan with the disk block in `render.yaml` to keep it.

**Railway:** deploy this folder (it uses the Dockerfile), add a volume mounted at `/data`, and set the three variables from `.env.example`.

Then open your URL, sign in with the admin token, and point agents at it with `VALETORA_URL`. Failed sign-ins are throttled (10/min per IP).

**Reviewers:** the dashboard has no public read-only mode. Share the admin token privately for a demo, ideally on a separate Moove account, since every link created is real.

## Public read-only demo (for reviewers)
Off by default. Enable with `VALETORA_PUBLIC_DEMO=1` (on Fly: `fly secrets set VALETORA_PUBLIC_DEMO=1`), then share `https://<your-app>/demo`.
It shows policy, budget, stats and the audit log (including payment link URLs, counterparties and agent names), plus a simulator that asks the policy engine "would this pass?" without creating links or touching the budget (30/min per IP). It exposes no ids or tokens, and every write route still requires your tokens. Use a dedicated demo Moove account.

## Demo agent (no AI subscription needed)
`demo-agent.js` is a scripted agent that calls the HTTP API: normal requests, an over-limit request, and an unfamiliar counterparty.
```bash
VALETORA_URL=https://<app>.fly.dev VALETORA_AGENT_TOKEN=... node demo-agent.js
```
`--once` makes a single request (use it right after pressing Pause), `--burn` runs until the daily limit blocks it, `--delay <ms>` sets the pace (default 1500, good for screen recording). Turn on the allow-list in the dashboard to see the unfamiliar-counterparty block. Every request it makes creates a real Moove link, so keep amounts small.

## Storage
Default is a JSON file (`VALETORA_DATA`). Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (from your Upstash database's REST API section; use the normal token, not the read-only one) to store state in Upstash Redis instead. This is what lets the free Render plan keep its audit log. `/health` shows which backend is active.
- State is one JSON value rewritten on each change, capped at 500 entries (entries from the last 7 days are always kept).
- If Upstash is unreachable at startup the server exits instead of overwriting history. If it fails mid-run, link creation and policy changes return 503 rather than proceeding unrecorded.
- Use one server instance per Redis key. Tested only against a local mock (`bash test-upstash.sh`); check Upstash's current free limits on their pricing page.

## Dashboard
Open `http://localhost:8787/` and sign in with the admin token. It's served by `server.js`, so it's same-origin and the token never leaves your server.

## HTTP API
| Route | Token | |
|---|---|---|
| GET /v1/budget | agent/admin | remaining budget |
| POST /v1/links | agent/admin | `{amount, counterparty, kind, description, expiresInMinutes}` |
| GET/PUT /v1/policy | admin | `{daily, weekly, perTx, mode:"any"\|"allow", allow:[...]}` |
| POST /v1/pause, /v1/resume | admin | global kill switch |
| GET /v1/log | admin | audit trail |
| POST /v1/reconcile | admin | pulls link status from Moove |

## Important: what Moove's API can and can't do
Moove's public API only creates, lists and retrieves payment links, and every link pays the key owner's own wallet. No endpoint sends funds. So today Valetora gates how much an agent can *request* (budgets, per-link max, allow-list, pause). True outbound agent spending needs Moove Send, which has no public API yet.

## Known limits
Budgets are rolling 24h / 7d and count requested link amounts, not payments received. JSON-file storage is fine for one owner; use a database for teams. Add TLS (reverse proxy) before exposing `server.js`.

Test: `bash test.sh` (uses a local mock of Moove).
