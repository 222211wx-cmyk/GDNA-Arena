---
name: Finance beta controls
description: Durable launch policy for simulated finance, Stripe activation, and manual payouts.
---

Arena Qaisypro must remain simulation-only, without a Stripe integration. The owner explicitly requested complete Stripe removal because its setup requirement blocked publishing. The beta may persist simulated 70/30 allocations and refunds; retain historical financial records and manual payout requests.

**Why:** The owner chose to collect users first, defer real payment connectivity until a US legal entity exists, and remove Stripe rather than complete its sandbox setup. Reintroducing the connector would contradict that decision and may block publishing again.

**How to apply:** Do not reintroduce payment-provider SDKs, connectors, setup prompts, or activation flags without explicit approval. Manual monthly RedotPay requests remain operational records, not automated transfers; bank details stay encrypted and masked. Historical provider identifiers in database schema and migrations must not be deleted merely to remove integration code.