#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${APP_DIR}/.." && pwd)"
OUT_DIR="${OUT_DIR:-${APP_DIR}/dist-rootfs}"
ROOTFS_PROFILE="${ROOTFS_PROFILE:-py-libp2p}"
ROOTFS_INSTALL_MODE="${ROOTFS_INSTALL_MODE:-}"
ROOTFS_SIZE_MIB="${ROOTFS_SIZE_MIB:-20480}"
CHANNEL="${CHANNEL:-ALEPH-CLOUDSOLUTIONS}"
SKIP_UPLOAD="${SKIP_UPLOAD:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
IPFS_ADD_URL="${IPFS_ADD_URL:-https://ipfs.aleph.cloud/api/v0/add}"
ORBITDB_RELAY_PINNER_DIR="${ORBITDB_RELAY_PINNER_DIR:-}"

case "${ROOTFS_PROFILE}" in
  py-libp2p)
    IMAGE_BASENAME="aleph-py-libp2p-relay.qcow2"
    DEFAULT_ROOTFS_VERSION="py-libp2p-relay-v0.1.0"
    if [ -z "${ROOTFS_INSTALL_MODE}" ]; then
      ROOTFS_INSTALL_MODE="thin"
    fi
    ;;
  orbitdb-relay-pinner)
    IMAGE_BASENAME="aleph-orbitdb-relay-pinner.qcow2"
    DEFAULT_ROOTFS_VERSION="orbitdb-relay-pinner-v0.1.0"
    if [ -z "${ROOTFS_INSTALL_MODE}" ]; then
      ROOTFS_INSTALL_MODE="prebaked"
    fi
    ;;
  *)
    echo "Unsupported ROOTFS_PROFILE: ${ROOTFS_PROFILE}" >&2
    echo "Expected one of: py-libp2p, orbitdb-relay-pinner" >&2
    exit 1
    ;;
esac

case "${ROOTFS_INSTALL_MODE}" in
  thin|prebaked)
    ;;
  *)
    echo "Unsupported ROOTFS_INSTALL_MODE: ${ROOTFS_INSTALL_MODE}" >&2
    echo "Expected one of: thin, prebaked" >&2
    exit 1
    ;;
esac

IMAGE="${OUT_DIR}/${IMAGE_BASENAME}"
ROOTFS_VERSION="${ROOTFS_VERSION:-${DEFAULT_ROOTFS_VERSION}}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
}

resolve_aleph_bin() {
  if [ -n "${ALEPH_BIN:-}" ]; then
    printf '%s\n' "${ALEPH_BIN}"
    return
  fi

  local local_aleph="${REPO_DIR}/aleph-client/.venv/bin/aleph"
  if [ -x "${local_aleph}" ]; then
    printf '%s\n' "${local_aleph}"
    return
  fi

  if command -v aleph >/dev/null 2>&1; then
    command -v aleph
    return
  fi

  echo "Missing aleph CLI. Set ALEPH_BIN=/path/to/aleph or install aleph-client." >&2
  exit 1
}

build_with_host_tools() {
  echo "Using host virt-customize/qemu-img toolchain."
  "${SCRIPT_DIR}/build-rootfs-image.sh"
}

build_with_docker() {
  require docker

  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed, but the Docker daemon is not running." >&2
    echo "Start Docker Desktop, wait until it is ready, then rerun rootfs/build-rootfs.sh." >&2
    exit 1
  fi

  echo "virt-customize is not available on this host."
  echo "Using Dockerized Debian/libguestfs builder instead."
  echo "This can be slow on macOS because qemu may run without hardware acceleration."

  docker build --platform linux/amd64 \
    -t aleph-relay-rootfs-builder:local \
    -f "${SCRIPT_DIR}/Dockerfile.rootfs" \
    "${SCRIPT_DIR}"

  local orbitdb_mount=()
  local orbitdb_env=()
  if [ "${ROOTFS_PROFILE}" = "orbitdb-relay-pinner" ]; then
    if [ -z "${ORBITDB_RELAY_PINNER_DIR}" ]; then
      echo "ROOTFS_PROFILE=orbitdb-relay-pinner requires ORBITDB_RELAY_PINNER_DIR=/path/to/orbitdb-relay-pinner" >&2
      exit 1
    fi
    if [ ! -d "${ORBITDB_RELAY_PINNER_DIR}" ]; then
      echo "Missing orbitdb-relay-pinner directory: ${ORBITDB_RELAY_PINNER_DIR}" >&2
      exit 1
    fi
    orbitdb_mount=(-v "${ORBITDB_RELAY_PINNER_DIR}:/workspace-orbitdb-relay-pinner:ro")
    orbitdb_env=(-e ORBITDB_RELAY_PINNER_DIR=/workspace-orbitdb-relay-pinner)
  fi

  docker run --rm --privileged --platform linux/amd64 \
    -e LIBGUESTFS_BACKEND=direct \
    -e ROOTFS_PROFILE="${ROOTFS_PROFILE}" \
    -e ROOTFS_INSTALL_MODE="${ROOTFS_INSTALL_MODE}" \
    -e PY_LIBP2P_DIR=/workspace/py-libp2p \
    "${orbitdb_env[@]}" \
    -e OUT_DIR=/workspace/relay-deployer-pwa/dist-rootfs \
    -e BASE_URL="${BASE_URL:-}" \
    -e IMAGE_SIZE="${IMAGE_SIZE:-20G}" \
    -v "${REPO_DIR}:/workspace" \
    "${orbitdb_mount[@]}" \
    -w /workspace/relay-deployer-pwa \
    aleph-relay-rootfs-builder:local \
    bash rootfs/build-rootfs-image.sh
}

required_port_forwards_json() {
  case "${ROOTFS_PROFILE}" in
    orbitdb-relay-pinner)
      cat <<'EOF'
  "requiredPortForwards": [
    { "port": 22, "tcp": true, "udp": false, "purpose": "SSH" },
    { "port": 9090, "tcp": true, "udp": false, "purpose": "Metrics and health API" },
    { "port": 9091, "tcp": true, "udp": false, "purpose": "libp2p TCP" },
    { "port": 9092, "tcp": true, "udp": false, "purpose": "libp2p WebSocket" },
    { "port": 9093, "tcp": false, "udp": true, "purpose": "WebRTC direct" },
    { "port": 9094, "tcp": false, "udp": true, "purpose": "QUIC" },
    { "port": 9443, "tcp": true, "udp": false, "purpose": "Metrics HTTPS" }
  ],
EOF
      ;;
  esac
}

write_manifest() {
  local rootfs_item_hash="$1"
  local rootfs_source_size_bytes=""
  local requires_bootstrap_network="false"
  local bootstrap_summary="Dependencies are preinstalled in the image."

  if [ "${ROOTFS_INSTALL_MODE}" = "thin" ]; then
    requires_bootstrap_network="true"
    bootstrap_summary="First boot installs runtime packages and application dependencies. Outbound network access is required before the relay service becomes healthy."
  fi

  if [ -f "${OUT_DIR}/ipfs-add-response.jsonl" ]; then
    rootfs_source_size_bytes="$(python3 - "${OUT_DIR}/ipfs-add-response.jsonl" <<'PY'
import json
import sys
from pathlib import Path

lines = [line for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
if not lines:
    raise SystemExit(0)

payload = json.loads(lines[-1])
size = payload.get("Size")
if isinstance(size, str) and size.isdigit():
    print(size)
elif isinstance(size, int) and size > 0:
    print(size)
PY
)"
  fi

  cat > "${OUT_DIR}/rootfs-manifest.json" <<EOF
{
  "profile": "${ROOTFS_PROFILE}",
  "version": "${ROOTFS_VERSION}",
  "rootfsInstallStrategy": "${ROOTFS_INSTALL_MODE}",
  "requiresBootstrapNetwork": ${requires_bootstrap_network},
  "bootstrapSummary": "${bootstrap_summary}",
$(if [[ "${rootfs_source_size_bytes}" =~ ^[0-9]+$ ]]; then printf '  "rootfsSourceSizeBytes": %s,\n' "${rootfs_source_size_bytes}"; fi)$(required_port_forwards_json)  "rootfsItemHash": "${rootfs_item_hash}",
  "rootfsSizeMiB": ${ROOTFS_SIZE_MIB},
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

  echo "Rootfs manifest written to ${OUT_DIR}/rootfs-manifest.json"
}

upload_image() {
  local aleph_bin
  aleph_bin="$(resolve_aleph_bin)"

  require python3
  require curl

  echo "Uploading ${IMAGE} to IPFS via ${IPFS_ADD_URL}..." >&2
  curl --fail --silent --show-error \
    -X POST \
    -F "file=@${IMAGE}" \
    "${IPFS_ADD_URL}" \
    > "${OUT_DIR}/ipfs-add-response.jsonl"

  local cid
  cid="$(python3 - "${OUT_DIR}/ipfs-add-response.jsonl" <<'PY'
import json
import sys
from pathlib import Path

lines = [line for line in Path(sys.argv[1]).read_text().splitlines() if line.strip()]
if not lines:
    raise SystemExit("No response received from the IPFS add endpoint")

payload = json.loads(lines[-1])
cid = payload.get("Hash")
if not cid:
    raise SystemExit(f"IPFS add response did not include a Hash: {payload}")

print(cid)
PY
)"

  echo "Pinning CID ${cid} on Aleph Cloud with ${aleph_bin}..." >&2
  "${aleph_bin}" file pin "${cid}" \
    --channel "${CHANNEL}" \
    > "${OUT_DIR}/store-message.json"

  python3 - "${OUT_DIR}/store-message.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text())
print(payload["item_hash"])
PY
}

mkdir -p "${OUT_DIR}"

echo "Building rootfs profile: ${ROOTFS_PROFILE}"
echo "Using install mode: ${ROOTFS_INSTALL_MODE}"

if [ "${SKIP_BUILD}" != "1" ]; then
  if command -v virt-customize >/dev/null 2>&1; then
    build_with_host_tools
  else
    build_with_docker
  fi
else
  echo "SKIP_BUILD=1 set; reusing ${IMAGE}"
fi

if [ "${SKIP_UPLOAD}" = "1" ]; then
  echo "SKIP_UPLOAD=1 set; image ready at ${IMAGE}"
  echo "Upload later with: SKIP_BUILD=1 rootfs/build-rootfs.sh"
  exit 0
fi

ROOTFS_ITEM_HASH="$(upload_image)"
write_manifest "${ROOTFS_ITEM_HASH}"
