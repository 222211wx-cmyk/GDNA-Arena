---
name: AMIS call system
description: WebRTC calls signaling path, production routing constraint, and auth rule
---

- Signaling WebSocket MUST live under `/api/ws` — the production deployment router only forwards `/api/*` to the api-server; any other path hits the static frontend and the socket never opens ("شبكة منقطعة" error on every call). **How to apply:** never move realtime endpoints off the `/api` prefix.
- WS upgrades are authenticated with the shared express-session middleware (exported from app.ts); identity (username) is derived server-side from session userId via DB lookup — client `register` payload identity is never trusted.
- Client (useCall.ts): answer failures must notify the caller (call-reject) and detach pcRef before pc.close() so the connection-state handler doesn't overwrite the recovered idle state.
- No TURN server configured (STUN only) — calls may still fail on strict NATs; that would be the next upgrade if citizens report connection drops mid-call.
