#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run as root on the external Ubuntu/Debian TURN VPS." >&2
  exit 1
fi

for name in TURN_HOSTNAME PUBLIC_IP; do
  if [[ -z ${!name:-} ]]; then
    echo "$name is required." >&2
    exit 1
  fi
done

BIND_IP=${BIND_IP:-$PUBLIC_IP}
[[ "$TURN_HOSTNAME" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
  || { echo "Invalid TURN_HOSTNAME" >&2; exit 1; }
for address in "$PUBLIC_IP" "$BIND_IP"; do
  [[ "$address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || { echo "This installer requires IPv4 PUBLIC_IP and BIND_IP." >&2; exit 1; }
  IFS=. read -r -a octets <<< "$address"
  for octet in "${octets[@]}"; do
    [[ ${#octet} -le 3 ]] && ((10#$octet <= 255)) \
      || { echo "Invalid IPv4 address." >&2; exit 1; }
  done
done
TEMPLATE="$(cd "$(dirname "$0")" && pwd)/coturn.conf.example"
[[ -f "$TEMPLATE" ]] || { echo "Missing $TEMPLATE" >&2; exit 1; }

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn certbot openssl

if [[ ! -f "/etc/letsencrypt/live/$TURN_HOSTNAME/fullchain.pem" ]]; then
  echo "Obtain a certificate first, for example:" >&2
  echo "  certbot certonly --standalone -d $TURN_HOSTNAME" >&2
  exit 1
fi

# Preserve the secret on re-runs so an installer retry does not invalidate
# credentials already configured in the API. Never print it in setup logs.
umask 077
SECRET_FILE=/root/arena-turn-shared-secret
if [[ ! -s "$SECRET_FILE" ]]; then
  if [[ -f /etc/turnserver.conf ]] && grep -q '^static-auth-secret=.' /etc/turnserver.conf; then
    sed -n 's/^static-auth-secret=//p' /etc/turnserver.conf | head -n 1 > "$SECRET_FILE"
  else
    openssl rand -hex 32 > "$SECRET_FILE"
  fi
fi
chmod 600 "$SECRET_FILE"
SECRET=$(cat "$SECRET_FILE")
[[ "$SECRET" =~ ^[A-Za-z0-9_-]{32,}$ ]] \
  || { echo "Existing secret cannot be safely rendered; preserve it and configure coturn manually." >&2; exit 1; }
sed \
  -e "s/TURN_HOSTNAME/$TURN_HOSTNAME/g" \
  -e "s/PUBLIC_IP/$PUBLIC_IP/g" \
  -e "s/PUBLIC_OR_PRIVATE_BIND_IP/$BIND_IP/g" \
  -e "s/GENERATED_SECRET/$SECRET/g" \
  "$TEMPLATE" > /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf
chmod 640 /etc/turnserver.conf

# The unprivileged turnserver service cannot traverse Let's Encrypt's private
# directories. Copy only this host's certificate/key to a restricted directory.
install -d -o root -g turnserver -m 750 /etc/coturn /etc/coturn/certs
install -o root -g turnserver -m 640 "/etc/letsencrypt/live/$TURN_HOSTNAME/fullchain.pem" /etc/coturn/certs/fullchain.pem
install -o root -g turnserver -m 640 "/etc/letsencrypt/live/$TURN_HOSTNAME/privkey.pem" /etc/coturn/certs/privkey.pem
install -d -m 755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/arena-coturn <<EOF
#!/bin/sh
set -eu
[ "\${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/$TURN_HOSTNAME" ] || exit 0
install -o root -g turnserver -m 640 "\$RENEWED_LINEAGE/fullchain.pem" /etc/coturn/certs/fullchain.pem
install -o root -g turnserver -m 640 "\$RENEWED_LINEAGE/privkey.pem" /etc/coturn/certs/privkey.pem
systemctl restart coturn
EOF
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/arena-coturn
install -d -m 755 /etc/systemd/system/coturn.service.d
cat > /etc/systemd/system/coturn.service.d/arena.conf <<'EOF'
[Service]
User=turnserver
Group=turnserver
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
EOF
if [[ -f /etc/default/coturn ]]; then
  sed -i '/^#\?TURNSERVER_ENABLED=/d' /etc/default/coturn
  printf '%s\n' 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi
systemctl daemon-reload
systemctl enable coturn
systemctl restart coturn
sleep 2
systemctl is-active --quiet coturn \
  || { echo "coturn failed to start. Inspect journalctl -u coturn." >&2; exit 1; }
ss -ltn | grep -Eq ':443[[:space:]]' \
  || { echo "TLS listener 443 not found. Inspect coturn logs." >&2; exit 1; }

cat <<EOF
coturn started locally, but has NOT been verified from an external network.
The shared secret is in $SECRET_FILE (root-only). Transfer it directly to the
API's TURN_SHARED_SECRET through the secure secrets form, not chat or logs.

After external verification, configure the API service:
CALL_MEDIA_PROVIDER=webrtc
TURN_URLS=turn:$TURN_HOSTNAME:3478?transport=udp,turn:$TURN_HOSTNAME:3478?transport=tcp,turns:$TURN_HOSTNAME:443?transport=tcp
Do not enable CALL_MEDIA_PROVIDER before external TLS, authenticated relay,
and real-device tests pass. Service startup alone is not a successful relay test.
EOF
