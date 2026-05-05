#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${APP_DIR}/.." && pwd)"
ROOTFS_PROFILE="${ROOTFS_PROFILE:-py-libp2p}"
ROOTFS_INSTALL_MODE="${ROOTFS_INSTALL_MODE:-}"
PY_LIBP2P_DIR="${PY_LIBP2P_DIR:-${REPO_DIR}/py-libp2p}"
ORBITDB_RELAY_PINNER_DIR="${ORBITDB_RELAY_PINNER_DIR:-}"
UNIVERSAL_CONNECTIVITY_DIR="${UNIVERSAL_CONNECTIVITY_DIR:-}"
OUT_DIR="${OUT_DIR:-${APP_DIR}/dist-rootfs}"
BASE_URL="${BASE_URL:-https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2}"
BASE_IMAGE="${OUT_DIR}/debian-12-genericcloud-amd64.qcow2"
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

case "${ROOTFS_PROFILE}" in
  py-libp2p)
    IMAGE="${OUT_DIR}/aleph-py-libp2p-relay.qcow2"
    APP_TAR="${OUT_DIR}/py-libp2p.tar"
    if [ -z "${ROOTFS_INSTALL_MODE}" ]; then
      ROOTFS_INSTALL_MODE="thin"
    fi
    if [ ! -d "${PY_LIBP2P_DIR}" ]; then
      echo "Missing py-libp2p directory: ${PY_LIBP2P_DIR}" >&2
      exit 1
    fi
    ;;
  orbitdb-relay-pinner)
    IMAGE="${OUT_DIR}/aleph-orbitdb-relay-pinner.qcow2"
    APP_TAR="${OUT_DIR}/orbitdb-relay-pinner.tar"
    if [ -z "${ROOTFS_INSTALL_MODE}" ]; then
      ROOTFS_INSTALL_MODE="prebaked"
    fi
    if [ -z "${ORBITDB_RELAY_PINNER_DIR}" ]; then
      echo "ROOTFS_PROFILE=orbitdb-relay-pinner requires ORBITDB_RELAY_PINNER_DIR=/path/to/orbitdb-relay-pinner" >&2
      exit 1
    fi
    if [ ! -d "${ORBITDB_RELAY_PINNER_DIR}" ]; then
      echo "Missing orbitdb-relay-pinner directory: ${ORBITDB_RELAY_PINNER_DIR}" >&2
      exit 1
    fi
    if [ ! -d "${ORBITDB_RELAY_PINNER_DIR}/dist" ]; then
      echo "Missing orbitdb-relay-pinner dist directory: ${ORBITDB_RELAY_PINNER_DIR}/dist" >&2
      echo "Build orbitdb-relay-pinner before creating this rootfs image." >&2
      exit 1
    fi
    if [ "${ROOTFS_INSTALL_MODE}" = "thin" ]; then
      echo "ROOTFS_PROFILE=orbitdb-relay-pinner now requires ROOTFS_INSTALL_MODE=prebaked." >&2
      echo "The runtime is installed into the image, then configured with mapped ports before first start." >&2
      exit 1
    fi
    ;;
  uc-go-peer)
    IMAGE="${OUT_DIR}/aleph-uc-go-peer.qcow2"
    APP_TAR="${OUT_DIR}/uc-go-peer.tar"
    if [ -z "${ROOTFS_INSTALL_MODE}" ]; then
      ROOTFS_INSTALL_MODE="prebaked"
    fi
    if [ -z "${UNIVERSAL_CONNECTIVITY_DIR}" ]; then
      echo "ROOTFS_PROFILE=uc-go-peer requires UNIVERSAL_CONNECTIVITY_DIR=/path/to/universal-connectivity" >&2
      exit 1
    fi
    if [ ! -d "${UNIVERSAL_CONNECTIVITY_DIR}/go-peer" ]; then
      echo "Missing go-peer directory: ${UNIVERSAL_CONNECTIVITY_DIR}/go-peer" >&2
      exit 1
    fi
    if [ "${ROOTFS_INSTALL_MODE}" = "thin" ]; then
      echo "ROOTFS_PROFILE=uc-go-peer requires ROOTFS_INSTALL_MODE=prebaked." >&2
      echo "The Go binary is built into the image, then configured with mapped ports before first start." >&2
      exit 1
    fi
    ;;
  uc-rust-peer)
    IMAGE="${OUT_DIR}/aleph-uc-rust-peer.qcow2"
    APP_TAR="${OUT_DIR}/uc-rust-peer.tar"
    if [ -z "${ROOTFS_INSTALL_MODE}" ]; then
      ROOTFS_INSTALL_MODE="prebaked"
    fi
    if [ -z "${UNIVERSAL_CONNECTIVITY_DIR}" ]; then
      echo "ROOTFS_PROFILE=uc-rust-peer requires UNIVERSAL_CONNECTIVITY_DIR=/path/to/universal-connectivity" >&2
      exit 1
    fi
    if [ ! -d "${UNIVERSAL_CONNECTIVITY_DIR}/rust-peer" ]; then
      echo "Missing rust-peer directory: ${UNIVERSAL_CONNECTIVITY_DIR}/rust-peer" >&2
      exit 1
    fi
    if [ "${ROOTFS_INSTALL_MODE}" = "thin" ]; then
      echo "ROOTFS_PROFILE=uc-rust-peer requires ROOTFS_INSTALL_MODE=prebaked." >&2
      echo "The Rust binary and websocket bridge are built into the image, then configured with mapped ports before first start." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported ROOTFS_PROFILE: ${ROOTFS_PROFILE}" >&2
    echo "Expected one of: py-libp2p, orbitdb-relay-pinner, uc-go-peer, uc-rust-peer" >&2
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

mkdir -p "${OUT_DIR}"

echo "Building ${ROOTFS_PROFILE} image in ${ROOTFS_INSTALL_MODE} mode"

if [ ! -f "${BASE_IMAGE}" ]; then
  curl -L "${BASE_URL}" -o "${BASE_IMAGE}"
fi

cp "${BASE_IMAGE}" "${IMAGE}"
qemu-img resize "${IMAGE}" "${IMAGE_SIZE}"

case "${ROOTFS_PROFILE}" in
  py-libp2p)
    tar \
      --exclude ".git" \
      --exclude ".venv" \
      --exclude "__pycache__" \
      -C "$(dirname "${PY_LIBP2P_DIR}")" \
      -cf "${APP_TAR}" \
      "$(basename "${PY_LIBP2P_DIR}")"

    py_customize_args=(
      -a "${IMAGE}"
      --mkdir /opt/py-libp2p
      --mkdir /var/lib/py-libp2p-relay
      --copy-in "${APP_TAR}:/opt"
      --copy-in "${SCRIPT_DIR}/relay-bootstrap.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/py-libp2p-relay.service:/etc/systemd/system"
      --copy-in "${SCRIPT_DIR}/py-libp2p-relay-bootstrap.service:/etc/systemd/system"
      --run-command "tar -xf /opt/$(basename "${APP_TAR}") -C /opt/py-libp2p --strip-components=1"
      --run-command "chmod 0755 /usr/local/sbin/relay-bootstrap.sh"
    )

    if [ "${ROOTFS_INSTALL_MODE}" = "prebaked" ]; then
      py_customize_args+=(
        --run-command "BOOTSTRAP_STAMP=/var/lib/py-libp2p-relay/bootstrap-complete RELAY_PORT=4001 /usr/local/sbin/relay-bootstrap.sh"
      )
    fi

    py_customize_args+=(
      --run-command "systemctl enable py-libp2p-relay.service"
      --run-command "rm -f /opt/$(basename "${APP_TAR}")"
    )

    virt-customize "${py_customize_args[@]}"
    ;;
  orbitdb-relay-pinner)
    tar \
      -C "${ORBITDB_RELAY_PINNER_DIR}" \
      -cf "${APP_TAR}" \
      dist \
      deploy \
      package.json \
      pnpm-lock.yaml \
      pnpm-workspace.yaml \
      README.md \
      LICENSE \
      .env.example

    orbitdb_customize_args=(
      -a "${IMAGE}"
      --mkdir /opt/orbitdb-relay-pinner
      --mkdir /var/lib/orbitdb-relay-pinner
      --mkdir /etc/systemd/system/orbitdb-relay-pinner.service.d
      --copy-in "${APP_TAR}:/opt"
      --copy-in "${SCRIPT_DIR}/orbitdb-relay-pinner-bootstrap.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/orbitdb-relay-pinner-configure.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/orbitdb-relay-pinner-autotls-refresh.py:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/orbitdb-relay-pinner-setup-server.py:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/orbitdb-relay-pinner-bootstrap.service:/etc/systemd/system"
      --copy-in "${SCRIPT_DIR}/orbitdb-relay-pinner-autotls-refresh.service:/etc/systemd/system"
      --copy-in "${SCRIPT_DIR}/orbitdb-relay-pinner-bootstrap.conf:/etc/systemd/system/orbitdb-relay-pinner.service.d"
      --run-command "tar -xf /opt/$(basename "${APP_TAR}") -C /opt/orbitdb-relay-pinner"
      --run-command "chmod 0755 /usr/local/sbin/orbitdb-relay-pinner-bootstrap.sh"
      --run-command "chmod 0755 /usr/local/sbin/orbitdb-relay-pinner-configure.sh"
      --run-command "chmod 0755 /usr/local/sbin/orbitdb-relay-pinner-autotls-refresh.py"
      --run-command "chmod 0755 /usr/local/sbin/orbitdb-relay-pinner-setup-server.py"
      --run-command "cp /opt/orbitdb-relay-pinner/deploy/orbitdb-relay-pinner.service /etc/systemd/system/orbitdb-relay-pinner.service"
      --run-command "INSTALL_DIR=/opt/orbitdb-relay-pinner DATA_DIR=/var/lib/orbitdb-relay-pinner ENV_FILE=/etc/default/orbitdb-relay-pinner SERVICE_USER=orbitdb-relay /usr/local/sbin/orbitdb-relay-pinner-bootstrap.sh"
    )

    orbitdb_customize_args+=(
      --run-command "systemctl enable orbitdb-relay-pinner-bootstrap.service"
      --run-command "systemctl enable orbitdb-relay-pinner.service"
      --run-command "rm -f /opt/$(basename "${APP_TAR}")"
    )

    virt-customize "${orbitdb_customize_args[@]}"
    ;;
  uc-go-peer)
    tar \
      --exclude ".git" \
      -C "${UNIVERSAL_CONNECTIVITY_DIR}" \
      -cf "${APP_TAR}" \
      go-peer

    uc_go_customize_args=(
      -a "${IMAGE}"
      --mkdir /opt/go-peer
      --mkdir /var/lib/uc-go-peer
      --copy-in "${APP_TAR}:/opt"
      --copy-in "${SCRIPT_DIR}/uc-go-peer-bootstrap.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-go-peer-configure.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-go-peer-autotls-refresh.py:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-go-peer-setup-server.py:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-go-peer-bootstrap.service:/etc/systemd/system"
      --copy-in "${SCRIPT_DIR}/uc-go-peer-autotls-refresh.service:/etc/systemd/system"
      --copy-in "${SCRIPT_DIR}/uc-go-peer.service:/etc/systemd/system"
      --run-command "tar -xf /opt/$(basename "${APP_TAR}") -C /opt"
      --run-command "chmod 0755 /usr/local/sbin/uc-go-peer-bootstrap.sh"
      --run-command "chmod 0755 /usr/local/sbin/uc-go-peer-configure.sh"
      --run-command "chmod 0755 /usr/local/sbin/uc-go-peer-autotls-refresh.py"
      --run-command "chmod 0755 /usr/local/sbin/uc-go-peer-setup-server.py"
      --run-command "INSTALL_DIR=/opt/go-peer DATA_DIR=/var/lib/uc-go-peer ENV_FILE=/etc/default/uc-go-peer SERVICE_USER=uc-go-peer /usr/local/sbin/uc-go-peer-bootstrap.sh base"
      --run-command "INSTALL_DIR=/opt/go-peer DATA_DIR=/var/lib/uc-go-peer ENV_FILE=/etc/default/uc-go-peer SERVICE_USER=uc-go-peer /usr/local/sbin/uc-go-peer-bootstrap.sh build"
      --run-command "INSTALL_DIR=/opt/go-peer DATA_DIR=/var/lib/uc-go-peer ENV_FILE=/etc/default/uc-go-peer SERVICE_USER=uc-go-peer /usr/local/sbin/uc-go-peer-bootstrap.sh finalize"
      --run-command "systemctl enable uc-go-peer-bootstrap.service"
      --run-command "systemctl enable uc-go-peer-autotls-refresh.service"
      --run-command "systemctl enable uc-go-peer.service"
      --run-command "rm -f /opt/$(basename "${APP_TAR}")"
    )

    virt-customize "${uc_go_customize_args[@]}"
    ;;
  uc-rust-peer)
    tar \
      --exclude "target" \
      --exclude ".git" \
      -C "${UNIVERSAL_CONNECTIVITY_DIR}" \
      -cf "${APP_TAR}" \
      rust-peer

    uc_rust_customize_args=(
      -a "${IMAGE}"
      --mkdir /opt/rust-peer
      --mkdir /var/lib/uc-rust-peer
      --copy-in "${APP_TAR}:/opt"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer-bootstrap.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer-configure.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer-setup-server.py:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer-ws-bridge.py:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer-run.sh:/usr/local/sbin"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer-bootstrap.service:/etc/systemd/system"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer.service:/etc/systemd/system"
      --copy-in "${SCRIPT_DIR}/uc-rust-peer-ws-bridge.service:/etc/systemd/system"
      --run-command "tar -xf /opt/$(basename "${APP_TAR}") -C /opt"
      --run-command "chmod 0755 /usr/local/sbin/uc-rust-peer-bootstrap.sh"
      --run-command "chmod 0755 /usr/local/sbin/uc-rust-peer-configure.sh"
      --run-command "chmod 0755 /usr/local/sbin/uc-rust-peer-setup-server.py"
      --run-command "chmod 0755 /usr/local/sbin/uc-rust-peer-ws-bridge.py"
      --run-command "chmod 0755 /usr/local/sbin/uc-rust-peer-run.sh"
      --run-command "INSTALL_DIR=/opt/rust-peer DATA_DIR=/var/lib/uc-rust-peer ENV_FILE=/etc/default/uc-rust-peer SERVICE_USER=uc-rust-peer /usr/local/sbin/uc-rust-peer-bootstrap.sh"
      --run-command "systemctl enable uc-rust-peer-bootstrap.service"
      --run-command "systemctl enable uc-rust-peer.service"
      --run-command "systemctl enable uc-rust-peer-ws-bridge.service"
      --run-command "rm -f /opt/$(basename "${APP_TAR}")"
    )

    virt-customize "${uc_rust_customize_args[@]}"
    ;;
esac

echo "Rootfs image ready at ${IMAGE}"
