---
name: GDNA Empire Design System
description: gdna-arena consumes @workspace/gdna-ds; theme rules and migration decisions
---

- `artifacts/gdna-ds` is the single source of truth for GDNA Arena's theme. Edit `tokens.json` only; generated files regenerate via `pnpm tokens` / dev server.
- Dark mode is canonical (site is dark-only): pure black bg, imperial gold `#C9A84C` primary, neon blue `#00d4ff` accent, gold-tinted borders. Light set is DERIVED (warm ivory + darkened gold `#a67c2e`).
- **Why gold primary, not the old token file's neon blue:** the app's visible brand (nav, buttons, crown logo) is gold; neon blue lives on as the accent role.
- gdna-arena's local `src/components/ui/`, `lib/utils.ts`, `hooks/use-toast.ts` were DELETED — imports come from `@workspace/gdna-ds/...`. Do not reintroduce local copies; only one global `Toaster` (in App.tsx — a duplicate in globalstar-app.tsx caused double toasts once).
- **How to apply:** new UI in gdna-arena should use token classes (bg-primary etc.); the owner's deliberate flourishes (red CTA buttons on homepage pillars, WhatsApp green) are his explicit choice — keep them.
- Main nav restructure (user-approved): 3 primary sections الساحة(/games)/المتجر(/shop)/المهام(/growth) + "الإمبراطورية" dropdown holding the old sections.
