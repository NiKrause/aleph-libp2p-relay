#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/default/orbitdb-relay-pinner}"
READY_FILE="${READY_FILE:-/etc/default/orbitdb-relay-pinner.ready}"
AUTOTLS_READY_FILE="${AUTOTLS_READY_FILE:-/etc/default/orbitdb-relay-pinner.autotls-ready}"
SERVICE_NAME="${SERVICE_NAME:-orbitdb-relay-pinner.service}"
AUTOTLS_REFRESH_SERVICE="${AUTOTLS_REFRESH_SERVICE:-orbitdb-relay-pinner-autotls-refresh.service}"
PUBLIC_IPV4=""
PUBLIC_IPV6=""
TCP_PORT=""
WS_PORT=""
METRICS_PORT=""
METRICS_HTTPS_PORT=""
WEBRTC_PORT=""
QUIC_PORT=""
START_SERVICE=1

usage() {
  cat <<'EOF'
Usage:
  orbitdb-relay-pinner-configure.sh \
    --public-ipv4 <ip> \
    [--public-ipv6 <ipv6>] \
    --tcp-port <host-port> \
    --ws-port <host-port> \
    [--metrics-port <host-port>] \
    [--metrics-https-port <host-port>] \
    [--webrtc-port <host-port>] \
    [--quic-port <host-port>] \
    [--no-start]

Writes VITE_APPEND_ANNOUNCE for the externally assigned Aleph host ports,
marks the relay as ready, and optionally starts the systemd service.
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
    --metrics-port)
      METRICS_PORT="${2:-}"
      shift 2
      ;;
    --metrics-https-port)
      METRICS_HTTPS_PORT="${2:-}"
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
rm -f "${AUTOTLS_READY_FILE}"

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
write_env_var "VITE_APPEND_ANNOUNCE" "${announce_value}"
write_env_var "PUBLIC_IPV4" "${PUBLIC_IPV4}"
if [ -n "${PUBLIC_IPV6}" ]; then
  write_env_var "PUBLIC_IPV6" "${PUBLIC_IPV6}"
fi
write_env_var "EXTERNAL_RELAY_TCP_PORT" "${TCP_PORT}"
write_env_var "EXTERNAL_RELAY_WS_PORT" "${WS_PORT}"
if [ -n "${METRICS_PORT}" ]; then
  write_env_var "EXTERNAL_METRICS_PORT" "${METRICS_PORT}"
fi
if [ -n "${METRICS_HTTPS_PORT}" ]; then
  write_env_var "EXTERNAL_METRICS_HTTPS_PORT" "${METRICS_HTTPS_PORT}"
fi
if [ -n "${WEBRTC_PORT}" ]; then
  write_env_var "EXTERNAL_RELAY_WEBRTC_PORT" "${WEBRTC_PORT}"
fi
if [ -n "${QUIC_PORT}" ]; then
  write_env_var "EXTERNAL_RELAY_QUIC_PORT" "${QUIC_PORT}"
fi
touch "${READY_FILE}"

if [ "${START_SERVICE}" -eq 1 ]; then
  systemctl daemon-reload
  systemctl enable "${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  systemctl start "${AUTOTLS_REFRESH_SERVICE}"
fi

printf 'Configured VITE_APPEND_ANNOUNCE=%s\n' "${announce_value}"
printf 'Ready file: %s\n' "${READY_FILE}"
