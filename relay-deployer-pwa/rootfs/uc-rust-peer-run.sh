#!/usr/bin/env bash
set -euo pipefail

data_dir="${RUST_PEER_DATA_DIR:-/var/lib/uc-rust-peer}"
listen_addresses="${RUST_PEER_LISTEN_ADDRESSES:-0.0.0.0,::}"
extra_args=()

if [ "${RUST_PEER_ENABLE_AUTONAT_SERVER:-1}" = "1" ]; then
  extra_args+=(--autonat-server)
fi

if [ "${RUST_PEER_ENABLE_RELAY_SERVER:-1}" = "1" ]; then
  extra_args+=(--relay-server)
fi

if [ -n "${RUST_PEER_EXTERNAL_ADDRESSES:-}" ]; then
  extra_args+=(--external-addresses "${RUST_PEER_EXTERNAL_ADDRESSES}")
fi

if [ -n "${RUST_PEER_CONNECT:-}" ]; then
  extra_args+=(--connect "${RUST_PEER_CONNECT}")
fi

exec /usr/local/bin/rust-libp2p-webrtc-peer \
  --headless \
  --listen-addresses "${listen_addresses}" \
  --local-key-path "${data_dir}/local" \
  --local-cert-path "${data_dir}/cert.pem" \
  "${extra_args[@]}"
