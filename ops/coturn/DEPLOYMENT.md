# External coturn deployment

Arena's Replit service remains on Agora by default. Replit's HTTP proxy cannot
publish coturn's UDP listener or relay range, so coturn must run on a Linux VPS
with a stable public IP. Nothing in this kit means that a live TURN service is
currently operational.

## DNS, NAT, and firewall

1. Point a dedicated hostname (for example `turn.example.com`) at the VPS.
2. If the server is behind 1:1 NAT, set `PUBLIC_IP` to the public address and
   `BIND_IP` to the interface's private address. Ensure the NAT forwards all
   ports below without remapping.
3. Allow inbound TCP 443, UDP/TCP 3478, and UDP 49160–49260. Restrict SSH
   separately. Allow matching outbound relay traffic and return traffic.
4. Install Certbot (`sudo apt-get update && sudo apt-get install -y certbot`) and
   obtain a real public certificate:
   `sudo certbot certonly --standalone -d turn.example.com`.
   The standalone HTTP challenge needs inbound TCP 80 during issuance/renewal;
   use a DNS challenge instead if that is not possible.
5. On the VPS run from this kit's directory:
   `sudo env TURN_HOSTNAME=turn.example.com PUBLIC_IP=203.0.113.10 bash ./setup-coturn.sh`.
   The installer supports IPv4 bind/public addresses. Configure IPv6 separately
   if the VPS needs it; do not substitute an IPv6 address in these commands.

The generated shared secret is saved in `/root/arena-turn-shared-secret` and
the service configuration; copy it directly to Replit Secrets, never chat,
source control, or a browser setting. Re-running the installer preserves it.
The API derives one-hour HMAC credentials. There is no static client password.
The installer gives the unprivileged service group read access to its config
and certificate copies, and grants only the capability needed to bind port 443.
It checks local service startup/listening, not external relay reachability.

## Certificate renewal

The installer creates a root-owned deploy hook which copies this hostname's
renewed certificate and key into `/etc/coturn/certs` with restricted permissions
before restarting coturn. Validate renewal on the VPS:

```sh
sudo certbot renew --dry-run
```

## Verification and rollout

Test from outside the VPS network with ephemeral credentials issued by the
authenticated API. Confirm UDP 3478, TCP 3478, and TLS/TCP 443 independently,
then force relay and confirm the selected candidate pair is `relay`. Inspect
coturn/syslog for denied peers, quota failures, and TLS errors.

Complete real-device calls in both directions across Wi-Fi↔Wi-Fi, Wi-Fi↔4G,
4G↔4G, and constrained 3G; include iOS Safari, Android Chrome, desktop Chrome,
Firefox, and Safari. Exercise camera-off audio, 360p adaptation, network loss,
ICE recovery, and a carrier network that blocks UDP.

Only after the signaling transport metadata and relay-only ICE-restart protocol
are deployed and the matrix passes, set API secrets:

```text
TURN_SHARED_SECRET=<generated value>
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:443?transport=tcp
CALL_MEDIA_PROVIDER=webrtc
```

Unset `CALL_MEDIA_PROVIDER` to keep the existing Agora service. An explicitly
selected but invalid WebRTC configuration returns HTTP 503 rather than silently
falling back to a different media transport.

TURN can relay traffic where direct peer connectivity fails; it cannot create
internet access, remove a carrier's data charge, or guarantee access through
restricted bundles such as *3 or *6. No carrier or real-device test has been
performed by creating this kit.
