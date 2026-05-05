#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/default/uc-rust-peer}"
READY_FILE="${READY_FILE:-/etc/default/uc-rust-peer.ready}"
PROXY_READY_FILE="${PROXY_READY_FILE:-/etc/default/uc-rust-peer.proxy-ready}"
SERVICE_NAME="${SERVICE_NAME:-uc-rust-peer.service}"
WS_BRIDGE_SERVICE="${WS_BRIDGE_SERVICE:-uc-rust-peer-ws-bridge.service}"
CADDY_SERVICE="${CADDY_SERVICE:-caddy.service}"
CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
CADDY_UPSTREAM_HOST="${CADDY_UPSTREAM_HOST:-127.0.0.1}"
CADDY_UPSTREAM_WS_PORT="${CADDY_UPSTREAM_WS_PORT:-9093}"
INTERNAL_TCP_PORT="${INTERNAL_TCP_PORT:-9092}"
INTERNAL_WS_PORT="${INTERNAL_WS_PORT:-9093}"
INTERNAL_WEBRTC_PORT="${INTERNAL_WEBRTC_PORT:-9090}"
INTERNAL_QUIC_PORT="${INTERNAL_QUIC_PORT:-9091}"
PUBLIC_IPV4=""
PUBLIC_IPV6=""
TCP_PORT=""
WS_PORT=""
PROXY_HOSTNAME=""
WEBRTC_PORT=""
QUIC_PORT=""
START_SERVICE=1

usage() {
  cat <<'EOF'
Usage:
  uc-rust-peer-configure.sh \
    --public-ipv4 <ip> \
    [--public-ipv6 <ipv6>] \
    --tcp-port <host-port> \
    --ws-port <host-port> \
    [--proxy-hostname <hostname>] \
    [--webrtc-port <host-port>] \
    [--quic-port <host-port>] \
    [--no-start]
EOF
}

write_env_var() {
  local key="$1"
  local value="$2"

  if grep -Eq "^[#[:space:]]*${key}=" "${ENV_FILE}"; then
    sed -i "s|^[#[:space:]]*${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

write_caddyfile() {
  local hostname="$1"
  mkdir -p "$(dirname "${CADDYFILE}")"
  cat > "${CADDYFILE}" <<EOF
${hostname} {
  reverse_proxy ${CADDY_UPSTREAM_HOST}:${CADDY_UPSTREAM_WS_PORT}
}
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --public-ipv4)
      PUBLIC_IPV4="${2:-}"
      shift 2
      ;;
    --public-ipv6)
      PUBLIC_IPV6="${2:-}"
      shift 2
      ;;
    --tcp-port)
      TCP_PORT="${2:-}"
      shift 2
      ;;
    --ws-port)
      WS_PORT="${2:-}"
      shift 2
      ;;
    --proxy-hostname)
      PROXY_HOSTNAME="${2:-}"
      shift 2
      ;;
    --webrtc-port)
      WEBRTC_PORT="${2:-}"
      shift 2
      ;;
    --quic-port)
      QUIC_PORT="${2:-}"
      shift 2
      ;;
    --no-start)
      START_SERVICE=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ -z "${PUBLIC_IPV4}" ] || [ -z "${TCP_PORT}" ] || [ -z "${WS_PORT}" ]; then
  usage >&2
  exit 1
fi

touch "${ENV_FILE}"

announce=(
  "/ip4/${PUBLIC_IPV4}/tcp/${TCP_PORT}"
  "/ip4/${PUBLIC_IPV4}/tcp/${WS_PORT}/ws"
)

if [ -n "${PUBLIC_IPV6}" ]; then
  announce+=(
    "/ip6/${PUBLIC_IPV6}/tcp/${TCP_PORT}"
    "/ip6/${PUBLIC_IPV6}/tcp/${WS_PORT}/ws"
  )
fi

if [ -n "${PROXY_HOSTNAME}" ]; then
  announce+=("/dns4/${PROXY_HOSTNAME}/tcp/443/tls/ws")
  announce+=("/dns6/${PROXY_HOSTNAME}/tcp/443/tls/ws")
fi

if [ -n "${WEBRTC_PORT}" ]; then
  announce+=("/ip4/${PUBLIC_IPV4}/udp/${WEBRTC_PORT}/webrtc-direct")
  if [ -n "${PUBLIC_IPV6}" ]; then
    announce+=("/ip6/${PUBLIC_IPV6}/udp/${WEBRTC_PORT}/webrtc-direct")
  fi
fi

if [ -n "${QUIC_PORT}" ]; then
  announce+=("/ip4/${PUBLIC_IPV4}/udp/${QUIC_PORT}/quic-v1")
  if [ -n "${PUBLIC_IPV6}" ]; then
    announce+=("/ip6/${PUBLIC_IPV6}/udp/${QUIC_PORT}/quic-v1")
  fi
fi

announce_value="$(IFS=,; printf '%s' "${announce[*]}")"
write_env_var "PUBLIC_IPV4" "${PUBLIC_IPV4}"
if [ -n "${PUBLIC_IPV6}" ]; then
  write_env_var "PUBLIC_IPV6" "${PUBLIC_IPV6}"
fi
write_env_var "EXTERNAL_RELAY_TCP_PORT" "${TCP_PORT}"
write_env_var "EXTERNAL_RELAY_WS_PORT" "${WS_PORT}"
if [ -n "${WEBRTC_PORT}" ]; then
  write_env_var "EXTERNAL_RELAY_WEBRTC_PORT" "${WEBRTC_PORT}"
fi
if [ -n "${QUIC_PORT}" ]; then
  write_env_var "EXTERNAL_RELAY_QUIC_PORT" "${QUIC_PORT}"
fi
if [ -n "${PROXY_HOSTNAME}" ]; then
  write_env_var "PROXY_HOSTNAME" "${PROXY_HOSTNAME}"
fi
write_env_var "RUST_PEER_ANNOUNCE_HINTS" "${announce_value}"

if [ "${TCP_PORT}" = "${INTERNAL_TCP_PORT}" ] && \
  { [ -z "${WEBRTC_PORT}" ] || [ "${WEBRTC_PORT}" = "${INTERNAL_WEBRTC_PORT}" ]; } && \
  { [ -z "${QUIC_PORT}" ] || [ "${QUIC_PORT}" = "${INTERNAL_QUIC_PORT}" ]; }; then
  if [ -n "${PUBLIC_IPV6}" ]; then
    write_env_var "RUST_PEER_EXTERNAL_ADDRESSES" "${PUBLIC_IPV4},${PUBLIC_IPV6}"
  else
    write_env_var "RUST_PEER_EXTERNAL_ADDRESSES" "${PUBLIC_IPV4}"
  fi
else
  write_env_var "RUST_PEER_EXTERNAL_ADDRESSES" ""
fi

touch "${READY_FILE}"

if [ "${START_SERVICE}" -eq 1 ]; then
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl enable "${WS_BRIDGE_SERVICE}"
  systemctl restart "${SERVICE_NAME}"
  systemctl restart "${WS_BRIDGE_SERVICE}"
  if [ -n "${PROXY_HOSTNAME}" ]; then
    write_caddyfile "${PROXY_HOSTNAME}"
    touch "${PROXY_READY_FILE}"
    systemctl enable "${CADDY_SERVICE}"
    systemctl restart "${CADDY_SERVICE}"
  else
    rm -f "${PROXY_READY_FILE}"
    systemctl stop "${CADDY_SERVICE}" || true
  fi
fi

printf 'Configured RUST_PEER_ANNOUNCE_HINTS=%s\n' "${announce_value}"
printf 'Ready file: %s\n' "${READY_FILE}"
