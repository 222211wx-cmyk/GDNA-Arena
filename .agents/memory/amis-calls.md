---
name: AMIS call system
description: Call media via Agora, signaling constraints, and auth rules
---

- Voice/video call MEDIA runs on Agora RTC, owner-mandated — raw WebRTC + STUN/TURN was removed for calls (live stories still use plain RTCPeerConnection). **Why:** owner explicitly ordered Agora after TURN-based reliability work; do not reintroduce Metered/TURN or manual ICE for calls.
- Pre-dial diagnostics must test Agora’s last-mile quality, not infer a peer route from browser ICE candidates. **Why:** only Agora’s metric reflects the transport used by calls and accounts for bitrate, loss, RTT, and jitter. **How to apply:** describe outcomes as ready, unstable, or unavailable—not direct/relay or a guaranteed call result.
- Agora channel = crypto-random call id; tokens are issued server-side only when an App Certificate secret is configured, otherwise App-ID-only (testing) mode. **Why:** predictable channel names + tokenless join let strangers eavesdrop — review-rejected once for exactly this. **How to apply:** any new Agora surface must fetch its token from the authenticated backend, never embed credentials beyond the public App ID.
- Agora tracks are bridged to the existing MediaStream-based call UI rather than Agora's play() API, so UI components stay transport-agnostic.
- Realtime signaling must stay under the `/api` path prefix — the production router only forwards `/api/*`; anything else silently hits the static frontend. Identity on the socket is always session-derived server-side, and the server only relays answer/reject/end for calls it saw offered, between the recorded participants.
- Client rule: answer failures must notify the caller and tear down media so the UI recovers to idle; "answered" in call history requires an actual active transition (ring time is not an answer).
