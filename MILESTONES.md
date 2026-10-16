# Moove Developer Program: milestone runbook

## A. One-time Moove setup (about 10 minutes, your account)
1. Claim a Moove Handle and set a default wallet with a settlement token. Without both, `POST /v1/payment-link` returns 409.
2. Create an API key at https://www.moove.xyz/dashboard/api-keys, scoped to the **Moove Receive Agent** (scopes `payment_link:create` and `payment_link:read`). The key is shown once. Save it.

## B. Deploy (see README.md)
```bash
fly launch --no-deploy --copy-config
fly volumes create valetora_data --size 1
fly secrets set MOOVE_API_KEY=mk_live_... VALETORA_PUBLIC_DEMO=1 \
  VALETORA_ADMIN_TOKEN=$(openssl rand -hex 24) VALETORA_AGENT_TOKEN=$(openssl rand -hex 24)
fly deploy
```
On Render's free plan, also set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so the log survives sleeps and redeploys. Status is reconciled with Moove every 10 minutes (`VALETORA_RECONCILE_MINUTES`).

## C. First real transactions
1. Sign in at `/`, set a policy (for example daily 30, weekly 150, per-link max 10).
2. "Test a request": create a 1-unit link. Open the URL and pay it from a different wallet. Click Reconcile; the entry should show `completed`.
3. No Claude subscription? Run `node demo-agent.js` (see README) to fill the audit log with approved and blocked requests. Or add the MCP server to Claude Code (README), set `VALETORA_URL` and the agent token, and ask it to create a link. Then ask for an over-limit link (blocked), then press Pause in the dashboard and ask again (blocked).

## D. Milestone 1 evidence: working MVP live (30-40%)
- [ ] Public GitHub repo (`.gitignore` already excludes `.env` and data files)
- [ ] Live URL: `https://<app>.fly.dev/demo` (read-only, simulator included)
- [ ] Moove payment links generated: screenshot of the audit log showing real `moove.xyz/@handle/pay/...` URLs
- [ ] 60-90 second video: run `demo-agent.js` (links created, over-limit blocked), press Pause in the dashboard, run `node demo-agent.js --once` to show it blocked
- [ ] Docs: README plus `SKILL.md`

## E. Milestone 2 plan: 10-20 unique users, 50+ real on-chain transactions
Important gap: this backend is **single-owner** (one Moove key per deployment). "Unique users" can mean either:
- **Self-hosted users**: others run the Docker image with their own Moove key. Works today, but you can't see their usage unless they share it.
- **Multi-tenant hosted service**: accounts, per-user encrypted Moove keys, per-user policies and a database. This is the real Phase 2 work. Ask the Moove team which they count before you build it.

Counting transactions: `/demo` shows "paid" from Moove link status, which comes from reconcile. Also keep a screenshot or export (CSV button on the dashboard) as evidence.

## F. Milestone 3
User testimonials or usage metrics, an improved skill/plugin, and a blog post.
