---
name: GDNA Empire Design System
description: gdna-arena consumes @workspace/gdna-ds; theme rules and migration decisions
---

- `artifacts/gdna-ds` is the single source of truth for GDNA Arena's theme. Edit `tokens.json` only; generated files regenerate via `pnpm tokens` / dev server.
- Dark mode is canonical (site is dark-only): pure black bg, imperial gold `#D4AF37` primary, neon blue `#00d4ff` accent, gold-tinted borders.
- **Why gold primary, not the old token file's neon blue:** the app's visible brand (nav, buttons, crown logo) is gold; neon blue lives on as the accent role.
- gdna-arena's local `src/components/ui/`, `lib/utils.ts`, `hooks/use-toast.ts` were DELETED — imports come from `@workspace/gdna-ds/...`. Do not reintroduce local copies; only one global `Toaster` (in App.tsx — a duplicate in globalstar-app.tsx caused double toasts once).
- **How to apply:** new UI in gdna-arena should use token classes (bg-primary etc.). External floating contact buttons are forbidden; messaging stays exclusively inside the empire's own messenger.
- Main nav: the owner REJECTED hiding sections in a dropdown (Aug 2026). All sections must stay visible flat in the top bar: الساحة/المتجر/المهام first, then SPORT, MUSIC, CINEMA, NEWS, HERITAGE, SOCIAL, MESSAGES, AMIS, SMART. Never collapse them without his explicit OK.
