---
name: Realtime messenger delivery
description: Durable delivery and call-cleanup rules for the shared AMIS WebSocket.
---

Every authenticated WebSocket for a citizen must receive private-room message pushes. Socket cleanup must be identity-aware: an older duplicate tab closing must never unregister a newer connection. Calls are tied to the specific signaling sockets that created them, so only a call-owning socket closing ends that call and releases the peer.

**Why:** Citizens commonly reconnect or open multiple app surfaces. A single client mapping let an old socket’s close event silently remove a newer session’s routing entry, and disconnected callers could otherwise leave their peer busy.

**How to apply:** Keep recipient identity and membership server-derived from persisted room membership. Preserve REST for initial/recovery loading, but do not use polling as primary delivery. Local direct-message safeguards run before the external guardian; its network wait is bounded so external latency cannot regress realtime delivery, following the guardian’s established fail-open policy.