---
name: GlobalStar earnings & admin security model
description: Identity and money rules for GlobalStar uploads/earnings/withdrawals and admin endpoints
---
- GlobalStar upload/earnings/withdrawal identity comes ONLY from the login session (username), never from client body/query. **Why:** endpoints used to trust `uploaderName` from the client — anyone could claim anyone's earnings or request withdrawals in another citizen's name.
- Withdrawal requests run inside a transaction with a per-citizen advisory lock. **Why:** the balance check was SELECT-then-INSERT; concurrent requests could overspend.
- Auth must run BEFORE multer parses multipart bodies on upload routes, or anonymous attackers write huge files to disk before their 401.
- Admin endpoints (`/api/admin/*`, `/api/seed`) require `users.is_admin`; seeding is disabled in production. **How to apply:** grant admin via `UPDATE users SET is_admin=true WHERE email=...` — the owner's real account still needs this in production (only the dev test account has it so far).
