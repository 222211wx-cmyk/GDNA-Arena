---
name: GDNA Empire Design System
description: gdna-arena consumes @workspace/gdna-ds; theme rules and migration decisions
---

- `artifacts/gdna-ds` is the single source of truth for GDNA Arena's theme. Edit `tokens.json` only; generated files regenerate via `pnpm tokens` / dev server.
- Dark mode is canonical (site is dark-only): pure black bg, imperial gold `#D4AF37` primary, neon blue `#00d4ff` accent, gold-tinted borders.
- **Why gold primary, not the old token file's neon blue:** the app's visible brand (nav, buttons, crown logo) is gold; neon blue lives on as the accent role.
- gdna-arena's local `src/components/ui/`, `lib/utils.ts`, `hooks/use-toast.ts` were DELETED — imports come from `@workspace/gdna-ds/...`. Do not reintroduce local copies; only one global `Toaster` (in App.tsx — a duplicate in globalstar-app.tsx caused double toasts once).
- **How to apply:** new UI in gdna-arena should use token classes (bg-primary etc.). External floating contact buttons are forbidden; messaging stays exclusively inside the empire's own messenger.
- Main nav remains flat, but the owner explicitly narrowed its labels on 2026-09-21 to أرينا | أنا | حيوان | المراسلات - MESSAGERI | اجتماعي - جهات الاتصال | Search | مستشار | SA.
- **Why:** This explicit latest request supersedes the earlier requirement to expose every section in the top bar. Preserve existing feature routes rather than deleting unrelated sections.

Clips has a specific exception to the main-site flat navigation rule: use four persistent destinations (Home, Clips, Search, Profile), with secondary destinations available in its menu.

**Why:** On 2026-09-19 the owner explicitly requested this Clips-specific layout after reporting being trapped in video playback. Visible home/grid exits take priority over immersive fullscreen.

**How to apply:** Keep this exception confined to Clips and its direct-code player; do not regroup the main site's navigation. Expanded clip playback must retain the navigation shell.
