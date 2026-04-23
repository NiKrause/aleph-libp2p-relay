# Relay Rootfs Release Flow

The PWA can now deploy either:

- an Aleph-managed base image such as Ubuntu 22 or Debian 12, or
- a custom qcow2 rootfs referenced by a prebuilt Aleph `STORE` `ItemHash`

This document covers the custom rootfs publishing flow. The browser never
builds or uploads the image itself.

## Profiles

The builder supports two rootfs profiles:

- `py-libp2p` (default): copies the local `py-libp2p` tree and enables `py-libp2p-relay.service`.
- `orbitdb-relay-pinner`: copies a minimal local `orbitdb-relay-pinner` payload and enables `orbitdb-relay-pinner.service` using the upstream `deploy/` files from that repo.

By default the builder now creates a `thin` rootfs image. That image uploads much
less data to Aleph, but the VM installs runtime packages and application
dependencies on first boot before the relay service becomes healthy.

## Build

Run the builder from a Linux host with `qemu-img`, `virt-customize`, `tar`,
`curl`, and `aleph-client` available. On macOS, the same command falls back to
a Dockerized Debian/libguestfs builder when `virt-customize` is not installed.

```bash
cd relay-deployer-pwa
rootfs/build-rootfs.sh
```

This builds the default `py-libp2p` image. The script:

1. Downloads a Debian 12 generic cloud image.
2. Copies the selected application tree into the disk image.
3. Installs the matching bootstrap and `systemd` service units.
4. Uploads the finished image to Aleph's IPFS add endpoint and then registers it with `aleph file pin`.
5. Writes `dist-rootfs/rootfs-manifest.json`.

Thin mode is the default:

- `ROOTFS_INSTALL_MODE=thin`: defer runtime package installation and dependency
  setup to first boot.
- `ROOTFS_INSTALL_MODE=prebaked`: keep the older behavior and preinstall
  dependencies into the qcow2 during the build.

To build the alternative OrbitDB relay image from a local checkout:

```bash
cd relay-deployer-pwa
ROOTFS_PROFILE=orbitdb-relay-pinner \
ORBITDB_RELAY_PINNER_DIR=/Users/nandi/orbitdb-relay-pinner \
rootfs/build-rootfs.sh
```

The generated qcow2 filename and the manifest `version` default both change with
`ROOTFS_PROFILE`.

## macOS Notes

Homebrew may provide `qemu-img` through `qemu`, but `virt-customize` is a
Linux/libguestfs tool and is not always available as a Homebrew formula. On a
Mac, install and start Docker Desktop, then run the same script. For the
default profile:

```bash
cd relay-deployer-pwa
export ALEPH_BIN=/Users/nandi/Projects/aleph-libp2p-relay/aleph-client/.venv/bin/aleph
rootfs/build-rootfs.sh
```

For the OrbitDB profile, keep the same `ALEPH_BIN` override and also provide the
external checkout path so the Docker builder can mount it read-only:

```bash
cd relay-deployer-pwa
export ALEPH_BIN=/Users/nandi/Projects/aleph-libp2p-relay/aleph-client/.venv/bin/aleph
ROOTFS_PROFILE=orbitdb-relay-pinner \
ORBITDB_RELAY_PINNER_DIR=/Users/nandi/orbitdb-relay-pinner \
rootfs/build-rootfs.sh
```

The container only builds/customizes the disk image. It runs as `linux/amd64`
because the default base cloud image is Debian amd64. Upload/signing still runs
on the host through `ALEPH_BIN`, so your Aleph account stays in your normal
local client environment.

To build the image without uploading it:

```bash
SKIP_UPLOAD=1 rootfs/build-rootfs.sh
```

To troubleshoot with the older fully baked behavior:

```bash
ROOTFS_INSTALL_MODE=prebaked rootfs/build-rootfs.sh
```

To reuse an already-built qcow2 image and only retry the IPFS/Aleph upload:

```bash
SKIP_BUILD=1 rootfs/build-rootfs.sh
```

Copy the generated manifest into `public/rootfs-manifest.json` before building
the PWA:

```bash
cp dist-rootfs/rootfs-manifest.json public/rootfs-manifest.json
pnpm build
```

## Runtime Defaults

### `py-libp2p`

- Relay TCP port: `4001`
- Relay seed: unset by default
- Service name: `py-libp2p-relay`
- Install directory: `/opt/py-libp2p`
- Bootstrap service: `py-libp2p-relay-bootstrap`
- Bootstrap stamp: `/var/lib/py-libp2p-relay/bootstrap-complete`

### `orbitdb-relay-pinner`

- Metrics/health port: `28190`
- Relay TCP/WS/WebRTC ports: `28191`, `28192`, `28193`
- Service name: `orbitdb-relay-pinner`
- Install directory: `/opt/orbitdb-relay-pinner`
- Environment file: `/etc/default/orbitdb-relay-pinner`
- Data directory: `/var/lib/orbitdb-relay-pinner`
- Bootstrap service: `orbitdb-relay-pinner-bootstrap`
- Bootstrap stamp: `/var/lib/orbitdb-relay-pinner/bootstrap-complete`

The OrbitDB profile copies the upstream `deploy/orbitdb-relay-pinner.service`
and `deploy/orbitdb-relay-pinner.env.example` from the source checkout into the
image. It does not try to guess the final public IP inside the rootfs build, so
you should review `/etc/default/orbitdb-relay-pinner` after boot and set
`VITE_APPEND_ANNOUNCE` or any port overrides to match the target host.

## First-Boot Requirements

Thin images require outbound network access on first boot:

- `py-libp2p` installs Python, build dependencies, and the virtualenv on boot.
- `orbitdb-relay-pinner` installs Node.js 22 and production dependencies on boot.

Expect the first boot to take noticeably longer than subsequent reboots. Use
`journalctl -u py-libp2p-relay-bootstrap` or
`journalctl -u orbitdb-relay-pinner-bootstrap` to troubleshoot bootstrap
failures.

The image must stay public and reproducible. Do not bake wallet keys, tokens,
private SSH keys, API credentials, or user-specific configuration into it.
