---
name: Finance beta controls
description: Durable launch policy for simulated finance, Stripe activation, and manual payouts.
---

Arena Qaisypro must remain simulation-only, without a Stripe integration. The owner explicitly requested complete Stripe removal because its setup requirement blocked publishing. Retain historical financial records and manual payout requests; the owner's final Life-Path policy supersedes the older 70/30 rule for new revenue.

**Why:** The owner chose to collect users first, defer real payment connectivity until a US legal entity exists, and remove Stripe rather than complete its sandbox setup. Reintroducing the connector would contradict that decision and may block publishing again.

**How to apply:** Do not reintroduce payment-provider SDKs, connectors, setup prompts, or activation flags without explicit approval. Manual monthly RedotPay requests remain operational records, not automated transfers; bank details stay encrypted and masked. Historical provider identifiers in database schema and migrations must not be deleted merely to remove integration code.

The final Life-Path policy is 60% of gross revenue for the citizen and 40% for the platform. The platform share covers storage, transcoding, CDN/link delivery and its profit; there are no additional citizen server charges or upfront upload payments. Zero revenue means zero citizen payment.

**Why:** The owner explicitly finalized this split, then corrected the presentation: put it in the site's terms, not a new published earnings dashboard.

**How to apply:** Publish the policy in terms across the supported languages, without inventing live revenue or rewriting historical allocations. Do not build or expose the previously requested new earnings dashboard.