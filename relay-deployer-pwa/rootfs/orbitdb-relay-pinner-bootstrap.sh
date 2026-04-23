#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/orbitdb-relay-pinner}"
SERVICE_NAME="${SERVICE_NAME:-orbitdb-relay-pinner}"
SERVICE_USER="${SERVICE_USER:-orbitdb-relay}"
DATA_DIR="${DATA_DIR:-/var/lib/orbitdb-relay-pinner}"
ENV_FILE="${ENV_FILE:-/etc/default/orbitdb-relay-pinner}"
BOOTSTRAP_STAMP="${BOOTSTRAP_STAMP:-}"

if [ -n "${BOOTSTRAP_STAMP}" ] && [ -f "${BOOTSTRAP_STAMP}" ]; then
  echo "orbitdb-relay-pinner bootstrap already completed at ${BOOTSTRAP_STAMP}."
  exit 0
fi

if [ ! -d "${INSTALL_DIR}" ]; then
  echo "Missing ${INSTALL_DIR}; the rootfs build did not copy orbitdb-relay-pinner."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg python3 build-essential

if ! command -v node >/dev/null 2>&1 || [ "$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

rm -rf /var/lib/apt/lists/*

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22+ installation failed." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is unavailable after installing Node.js." >&2
  exit 1
fi

mkdir -p "${DATA_DIR}"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home "${DATA_DIR}" --create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}" "${INSTALL_DIR}"

install_command="cd '${INSTALL_DIR}' && npm install --omit=dev"
if [ -f "${INSTALL_DIR}/pnpm-lock.yaml" ] && command -v corepack >/dev/null 2>&1; then
  package_manager="$(
    node -e "const fs=require('fs'); const pkg=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(pkg.packageManager || '')" \
      "${INSTALL_DIR}/package.json" 2>/dev/null || true
  )"
  if [ -n "${package_manager}" ]; then
    install_command="cd '${INSTALL_DIR}' && corepack enable && corepack prepare '${package_manager}' --activate && pnpm install --prod --frozen-lockfile"
  fi
fi

if command -v runuser >/dev/null 2>&1; then
  runuser -u "${SERVICE_USER}" -- env HOME="${DATA_DIR}" bash -lc "${install_command}"
elif command -v sudo >/dev/null 2>&1; then
  sudo -u "${SERVICE_USER}" env HOME="${DATA_DIR}" bash -lc "${install_command}"
else
  echo "Need runuser or sudo to install dependencies as ${SERVICE_USER}." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}/node_modules"
ln -sfn "${INSTALL_DIR}" "${INSTALL_DIR}/node_modules/orbitdb-relay-pinner"

if [ -f "${INSTALL_DIR}/deploy/orbitdb-relay-pinner.env.example" ] && [ ! -f "${ENV_FILE}" ]; then
  cp "${INSTALL_DIR}/deploy/orbitdb-relay-pinner.env.example" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
  chown "root:${SERVICE_USER}" "${ENV_FILE}"
fi

if [ -n "${BOOTSTRAP_STAMP}" ]; then
  touch "${BOOTSTRAP_STAMP}"
fi
