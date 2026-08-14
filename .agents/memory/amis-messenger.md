---
name: AMIS unified messenger
description: Architectural decisions behind the single shared messenger component.
---

# AMIS unified messenger

- ONE shared Messenger component (variant prop: full / embedded / widget) powers every chat surface. **Why:** three divergent messenger UIs confused the owner; task #131 unified them. **How to apply:** never fork a per-surface messenger — extend the shared component.
- Never claim end-to-end encryption in the UI — the honest label is "مشفّر عبر الخادم" (encrypted via server). Owner-approved wording.
- Single-pane surfaces (widget/mobile) must show exactly one pane; overlays (history/settings) live in the chat pane, so the sidebar must yield or the overlay renders zero-width.
- Call-history logging must live in the single call hook/provider, never in a chat component — the messenger can be mounted on multiple surfaces at once and would double-log. "Answered" requires an actual active transition; ring duration is not evidence of an answer.
- Messenger mute/settings columns were added by raw DDL, not the drizzle schema — query them via the pg pool, and keep new one-off columns out of drizzle unless regenerating lib/db types.
- Settings toggles must map to real behavior (notifications → floating-button badge; read receipts = privacy pref) — a persisted-but-inert toggle gets rejected in review.
