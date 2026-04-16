#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/py-libp2p}"
SERVICE_NAME="${SERVICE_NAME:-py-libp2p-relay}"
RELAY_PORT="${RELAY_PORT:-4001}"
RELAY_SEED="${RELAY_SEED:-}"

if [ ! -d "${INSTALL_DIR}" ]; then
  echo "Missing ${INSTALL_DIR}; the rootfs build did not copy py-libp2p."
  exit 1
fi

python3 -m venv "${INSTALL_DIR}/.venv"
"${INSTALL_DIR}/.venv/bin/pip" install --upgrade pip wheel
"${INSTALL_DIR}/.venv/bin/pip" install -e "${INSTALL_DIR}"

if [ -n "${RELAY_SEED}" ]; then
  RELAY_SEED_ARG="--seed ${RELAY_SEED}"
else
  RELAY_SEED_ARG=""
fi

cat > /etc/py-libp2p-relay.env <<EOF
RELAY_PORT=${RELAY_PORT}
RELAY_SEED_ARG=${RELAY_SEED_ARG}
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
