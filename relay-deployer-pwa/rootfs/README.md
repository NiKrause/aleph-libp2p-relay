# Relay Rootfs Release Flow

The PWA deploys an Aleph instance by referencing a prebuilt rootfs `ItemHash`.
The browser never builds or uploads this image.

## Build

Run the builder from a Linux host with `qemu-img`, `virt-customize`, `tar`,
`curl`, and `aleph-client` available. On macOS, the same command falls back to
a Dockerized Debian/libguestfs builder when `virt-customize` is not installed.

```bash
cd relay-deployer-pwa
rootfs/build-rootfs.sh
```

The script:

1. Downloads a Debian 12 generic cloud image.
2. Copies the local `py-libp2p` tree into the disk image.
3. Installs the relay bootstrap and `systemd` service.
4. Uploads the finished image to Aleph's IPFS add endpoint and then registers it with `aleph file pin`.
5. Writes `dist-rootfs/rootfs-manifest.json`.

## macOS Notes

Homebrew may provide `qemu-img` through `qemu`, but `virt-customize` is a
Linux/libguestfs tool and is not always available as a Homebrew formula. On a
Mac, install and start Docker Desktop, then run the same script:

```bash
cd relay-deployer-pwa
export ALEPH_BIN=/Users/nandi/Projects/aleph-libp2p-relay/aleph-client/.venv/bin/aleph
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

- Relay TCP port: `4001`
- Relay seed: unset by default
- Service name: `py-libp2p-relay`
- Install directory: `/opt/py-libp2p`

The image must stay public and reproducible. Do not bake wallet keys, tokens,
private SSH keys, API credentials, or user-specific configuration into it.
