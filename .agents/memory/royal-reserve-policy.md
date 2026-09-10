---
name: Royal Reserve policy
description: Meaning of reserve call credit, debt consent, offline limits, and beta settlement boundaries.
---

Royal Reserve means application call credit, not carrier connectivity. The agreed package is 120 minutes valid for 48 hours, with an explicitly accepted simulated 15 MAD debt; incoming top-ups pay debt before adding spendable credit. Do not create a new loan silently or reset an outstanding loan through repeat activation.

**Why:** The owner accepted an internet-required reserve but later repeated “even without internet.” That wording cannot be implemented as an offline internet call, and charging disconnected time would misrepresent the service.

**How to apply:** Present the reserve as “رصيد احتياطي”. Use the activation message “تم تفعيل الرصيد الاحتياطي. سيتم خصم الرصيد عند الشحن التالي”. Clearly disclose consent, expiry, and simulation. Charge the initiating caller's connected talk time only; no charge for ringing or offline intervals. Treat online/browser connection hints as hints, not proof of media connectivity.

Do not enable real top-ups or debt collection as part of call-network work.

**Why:** The project's existing finance-beta decision defers live money until legal and operational approval. A client-submitted amount is not proof of payment.

**How to apply:** Keep manual simulated repayment behind an explicit development sandbox gate; production settlement must eventually use trusted, authenticated payment confirmation.