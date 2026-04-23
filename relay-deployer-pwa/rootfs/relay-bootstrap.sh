#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/py-libp2p}"
SERVICE_NAME="${SERVICE_NAME:-py-libp2p-relay}"
RELAY_PORT="${RELAY_PORT:-4001}"
RELAY_SEED="${RELAY_SEED:-}"
DATA_DIR="${DATA_DIR:-/var/lib/py-libp2p-relay}"
ENV_FILE="${ENV_FILE:-/etc/py-libp2p-relay.env}"
BOOTSTRAP_STAMP="${BOOTSTRAP_STAMP:-}"

if [ -n "${BOOTSTRAP_STAMP}" ] && [ -f "${BOOTSTRAP_STAMP}" ]; then
  echo "py-libp2p bootstrap already completed at ${BOOTSTRAP_STAMP}."
  exit 0
fi

if [ ! -d "${INSTALL_DIR}" ]; then
  echo "Missing ${INSTALL_DIR}; the rootfs build did not copy py-libp2p."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl python3 python3-pip python3-venv build-essential libgmp-dev
rm -rf /var/lib/apt/lists/*

mkdir -p "${DATA_DIR}"

python3 -m venv "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip wheel
"${INSTALL_DIR}/.venv/bin/pip" install "${INSTALL_DIR}"

if [ -n "${RELAY_SEED}" ]; then
  RELAY_SEED_ARG="--seed ${RELAY_SEED}"
else
  RELAY_SEED_ARG=""
fi

cat > "${ENV_FILE}" <<EOF
RELAY_PORT=${RELAY_PORT}
RELAY_SEED_ARG=${RELAY_SEED_ARG}
EOF

if [ -n "${BOOTSTRAP_STAMP}" ]; then
  touch "${BOOTSTRAP_STAMP}"
fi
