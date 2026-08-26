---
name: AMIS call system
description: Call media via Agora, signaling constraints, and auth rules
---

- Voice/video call MEDIA runs on Agora RTC, owner-mandated — raw WebRTC + STUN/TURN was removed for calls (live stories still use plain RTCPeerConnection). **Why:** owner explicitly ordered Agora after TURN-based reliability work; do not reintroduce Metered/TURN or manual ICE for calls.
- Pre-dial diagnostics must test Agora’s last-mile quality, not infer a peer route from browser ICE candidates. **Why:** only Agora’s metric reflects the transport used by calls and accounts for bitrate, loss, RTT, and jitter. **How to apply:** describe outcomes as ready, unstable, or unavailable—not direct/relay or a guaranteed call result.
- Agora channel = crypto-random call id; certificate-backed, participant-scoped tokens are mandatory and missing credentials must fail explicitly—never fall back to tokenless App-ID mode. **Why:** predictable channels or tokenless joins let strangers eavesdrop. **How to apply:** every Agora surface fetches its token from the authenticated backend and keeps the App Certificate server-side.
- Production token configuration must be read from runtime `process.env` on each token request, and the browser must obtain a complete signed token before creating AgoraRTC; retry transient 503 readiness responses. **Why:** deployment secret injection can briefly be unavailable, and module-level snapshots or client-first startup produce “channel closed before secrets service was ready.”
- Call media uses Agora `aes-256-gcm2` with a browser-generated secret RSA-wrapped for every active callee device; all peers derive the required 32-byte public salt from the call channel. The signaling server validates the exact device fingerprints but never receives the clear media secret. **Why:** multi-device ringing and real media E2EE both failed when only one user-level key or no GCM2 salt was used.
- Agora tracks are bridged to the existing MediaStream-based call UI rather than Agora's play() API, so UI components stay transport-agnostic.
- Realtime signaling must stay under the `/api` path prefix — the production router only forwards `/api/*`; anything else silently hits the static frontend. Identity on the socket is always session-derived server-side, and the server only relays answer/reject/end for calls it saw offered, between the recorded participants.
- Client rule: answer failures must notify the caller and tear down media so the UI recovers to idle; "answered" in call history requires an actual active transition (ring time is not an answer).
