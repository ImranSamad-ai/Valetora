---
name: valetora
description: Create Moove payment links within the owner's spending policy. Use when you need to request a payment or generate a payment link.
---
1. Call `check_budget` first. If `paused` is true, stop and tell the user.
2. Call `create_payment_link` with `amount` (decimal string), `counterparty` (merchant/domain) and a clear `description`. Use `kind: "one-time"` unless told otherwise.
3. If the result has `ok: false`, report the `reason` to the user. Do not retry with split amounts or altered counterparties to get around a policy.
4. If `ok: true`, give the user the `url`.
You cannot change policy or resume spending; only the owner can.
