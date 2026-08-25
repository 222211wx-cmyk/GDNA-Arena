---
name: AMIS unified messenger
description: Architectural decisions behind the single shared messenger component.
---

# AMIS unified messenger

- ONE shared Messenger component (variant prop: full / embedded / widget) powers every chat surface. **Why:** three divergent messenger UIs confused the owner; unifying them removed surface-specific drift. **How to apply:** never fork a per-surface messenger — extend the shared component.
- Never claim end-to-end encryption in the UI — the honest label is "مشفّر عبر الخادم" (encrypted via server). Owner-approved wording.
- Single-pane surfaces (widget/mobile) must show exactly one pane; overlays (history/settings) live in the chat pane, so the sidebar must yield or the overlay renders zero-width.
- Call-history logging must live in the single call hook/provider, never in a chat component — the messenger can be mounted on multiple surfaces at once and would double-log. "Answered" requires an actual active transition; ring duration is not evidence of an answer.
- Messenger mute/settings columns were added by raw DDL, not the drizzle schema — query them via the pg pool, and keep new one-off columns out of drizzle unless regenerating lib/db types.
- WhatsApp-style layout is the owner-approved shape: 4 fixed bottom tabs (Discussions | Actus | Communautés | Appels) + fullscreen chat page. The full-variant chat MUST be portaled to document.body — ancestor transforms trap position:fixed and the site navbar bleeds through otherwise. GIPHY/GIF is permanently removed per owner order.
- Mobile keyboard stability: viewport meta needs `interactive-widget=resizes-content`; composer textarea is dir="auto" at 16px (prevents iOS zoom + renders Arabic RTL correctly).
- Async hygiene: message fetch/send commits must be guarded by an active-room ref (stale responses leaked another room's conversation), and MediaRecorder + its stream must be torn down on unmount or the mic stays live.
- Settings toggles must map to real behavior (notifications → floating-button badge; read receipts = privacy pref) — a persisted-but-inert toggle gets rejected in review.
- Actus is the Solidarity Relay: completion counters track every genuine contribution, but XP/score rewards are capped to one creator and one supporter reward per citizen per UTC day. **Why:** per-initiative uniqueness still let a fixed cohort farm new initiatives. **How to apply:** serialize completion and grant points only after an atomic daily reward-ledger insert.
- The dedicated `/messages` surface must suppress global AMIS/AI floating launchers, while embedded and widget variants keep them. **Why:** fixed launchers overlapped the mobile composer and initiative forms.
- `/social` is the communication-network overview: it aggregates live status and launches existing AMIS, Pulse, events, citizens, friends, and search surfaces without deleting or relocating their tools. **Why:** the owner wants one discoverable communication future, but explicitly rejected removing sections. **How to apply:** add new channels to the overview while preserving their dedicated routes and existing tabs.
