---
name: Finance beta controls
description: Durable launch policy for simulated finance, Stripe activation, and manual payouts.
---

Arena Qaisypro must remain in finance simulation mode until the owner establishes a US LLC and explicitly approves a separate live-money readiness process. The beta may persist simulated 70/30 allocations and refunds, but it must not create Stripe accounts, payment intents, transfers, or payouts.

**Why:** The owner explicitly chose to collect users first and defer real Stripe connectivity until the US legal entity exists. Accidental activation would create legal and financial risk.

**How to apply:** Keep the explicit live-mode acknowledgement unset for beta releases. Manual monthly RedotPay requests are operational records, not automated transfers; bank details stay encrypted and masked. Before live activation, verify legal ownership, Stripe capabilities, signed webhooks, concurrent refunds, and append-only ledger enforcement against a real test database.