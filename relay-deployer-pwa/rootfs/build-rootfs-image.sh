#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${APP_DIR}/.." && pwd)"
PY_LIBP2P_DIR="${PY_LIBP2P_DIR:-${REPO_DIR}/py-libp2p}"
OUT_DIR="${OUT_DIR:-${APP_DIR}/dist-rootfs}"
BASE_URL="${BASE_URL:-https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2}"
BASE_IMAGE="${OUT_DIR}/debian-12-genericcloud-amd64.qcow2"
IMAGE="${OUT_DIR}/aleph-py-libp2p-relay.qcow2"
IMAGE_SIZE="${IMAGE_SIZE:-20G}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

require curl
require qemu-img
require virt-customize
require tar

if [ ! -d "${PY_LIBP2P_DIR}" ]; then
  echo "Missing py-libp2p directory: ${PY_LIBP2P_DIR}" >&2
  exit 1
fi

mkdir -p "${OUT_DIR}"

if [ ! -f "${BASE_IMAGE}" ]; then
  curl -L "${BASE_URL}" -o "${BASE_IMAGE}"
fi

cp "${BASE_IMAGE}" "${IMAGE}"
qemu-img resize "${IMAGE}" "${IMAGE_SIZE}"

tar \
  --exclude ".git" \
  --exclude ".venv" \
  --exclude "__pycache__" \
  -C "$(dirname "${PY_LIBP2P_DIR}")" \
  -cf "${OUT_DIR}/py-libp2p.tar" \
  "$(basename "${PY_LIBP2P_DIR}")"

virt-customize -a "${IMAGE}" \
  --install "ca-certificates,curl,git,python3,python3-pip,python3-venv,build-essential,libgmp-dev" \
  --mkdir /opt/py-libp2p \
  --copy-in "${OUT_DIR}/py-libp2p.tar:/opt" \
  --copy-in "${SCRIPT_DIR}/relay-bootstrap.sh:/usr/local/sbin" \
  --copy-in "${SCRIPT_DIR}/py-libp2p-relay.service:/etc/systemd/system" \
  --run-command "tar -xf /opt/py-libp2p.tar -C /opt/py-libp2p --strip-components=1" \
  --run-command "chmod 0755 /usr/local/sbin/relay-bootstrap.sh" \
  --run-command "RELAY_PORT=4001 /usr/local/sbin/relay-bootstrap.sh" \
  --run-command "apt-get clean" \
  --run-command "rm -f /opt/py-libp2p.tar"

echo "Rootfs image ready at ${IMAGE}"
