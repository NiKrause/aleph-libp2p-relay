#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/rust-peer}"
SERVICE_USER="${SERVICE_USER:-uc-rust-peer}"
DATA_DIR="${DATA_DIR:-/var/lib/uc-rust-peer}"
ENV_FILE="${ENV_FILE:-/etc/default/uc-rust-peer}"
READY_FILE="${READY_FILE:-/etc/default/uc-rust-peer.ready}"
PROXY_READY_FILE="${PROXY_READY_FILE:-/etc/default/uc-rust-peer.proxy-ready}"

if [ ! -d "${INSTALL_DIR}" ]; then
  echo "Missing ${INSTALL_DIR}; the rootfs build did not copy rust-peer."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates caddy curl build-essential pkg-config protobuf-compiler libssl-dev python3 python3-websockets
rm -rf /var/lib/apt/lists/*

mkdir -p "${DATA_DIR}" "$(dirname "${ENV_FILE}")"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${DATA_DIR}" --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

if [ ! -x /root/.cargo/bin/cargo ]; then
  curl https://sh.rustup.rs -sSf | sh -s -- -y --profile minimal --default-toolchain stable
fi

export PATH="/root/.cargo/bin:${PATH}"
cd "${INSTALL_DIR}"
cargo build --release --bin main

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}" "${INSTALL_DIR}"

install -m 0755 "${INSTALL_DIR}/target/release/main" /usr/local/bin/rust-libp2p-webrtc-peer
rm -rf "${INSTALL_DIR}/target"

touch "${ENV_FILE}"
chmod 0640 "${ENV_FILE}"
chown "root:${SERVICE_USER}" "${ENV_FILE}"
rm -f "${READY_FILE}" "${PROXY_READY_FILE}"

write_env_var() {
  local key="$1"
  local value="$2"

  if grep -Eq "^[#[:space:]]*${key}=" "${ENV_FILE}"; then
    sed -i "s|^[#[:space:]]*${key}=.*|${key}=${value}|" "${ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" >> "${ENV_FILE}"
  fi
}

mkdir -p /etc/caddy /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/uc-rust-peer.conf <<EOF
[Unit]
ConditionPathExists=${PROXY_READY_FILE}
EOF

write_env_var "RUST_PEER_DATA_DIR" "${DATA_DIR}"
write_env_var "RUST_PEER_LISTEN_ADDRESSES" "0.0.0.0,::"
write_env_var "RUST_PEER_TCP_PORT" "9092"
write_env_var "RUST_PEER_WS_PORT" "9093"
write_env_var "RUST_PEER_WEBRTC_PORT" "9090"
write_env_var "RUST_PEER_QUIC_PORT" "9091"
write_env_var "RUST_PEER_ENABLE_RELAY_SERVER" "1"
write_env_var "RUST_PEER_ENABLE_AUTONAT_SERVER" "1"
write_env_var "RUST_PEER_HEADLESS" "1"
