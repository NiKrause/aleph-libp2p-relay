# Aleph Relay Deployer PWA

Static Svelte PWA for deploying a prebuilt `py-libp2p` relay VM on Aleph Cloud
directly from the browser. There is no app server.

## What It Does

- Connects MetaMask.
- Loads live Aleph instance pricing, wallet balance, credits, and CRNs.
- Offers `hold` and `credit` payment modes.
- Supports Aleph-provided base images and custom pinned rootfs manifests.
- Builds, signs, and broadcasts an Aleph `INSTANCE` message in the browser.
- Lists previous Aleph instance messages for the connected wallet.

## Development

```bash
pnpm install
pnpm dev
```

## Production Build

```bash
pnpm build
```

The output in `dist/` is fully static and can be served by any static host or
published through IPFS/Aleph hosting.

## Rootfs Sources

The deploy form now defaults to Aleph-managed base images like Ubuntu 22 and Debian 12.
That path does not require a custom `STORE` rootfs message.

If you want to use a custom qcow2 rootfs instead, keep using
`public/rootfs-manifest.json` and build/upload the image first:

```bash
rootfs/build-rootfs.sh
cp dist-rootfs/rootfs-manifest.json public/rootfs-manifest.json
```

The rootfs builder now defaults to a thin image. That keeps the uploaded qcow2
much smaller, but the deployed VM installs runtime packages and application
dependencies on first boot. Outbound network access is required during that
bootstrap phase, and the service may take longer to become healthy immediately
after deployment. This only applies when you choose `Custom rootfs` in the UI.

To build the alternative OrbitDB relay image instead of the default
`py-libp2p` image:

```bash
ROOTFS_PROFILE=orbitdb-relay-pinner \
ORBITDB_RELAY_PINNER_DIR=/Users/nandi/orbitdb-relay-pinner \
rootfs/build-rootfs.sh
cp dist-rootfs/rootfs-manifest.json public/rootfs-manifest.json
```

For troubleshooting you can still force the older fully baked image path:

```bash
ROOTFS_INSTALL_MODE=prebaked rootfs/build-rootfs.sh
```

When `Custom rootfs` is selected, the PWA blocks deployment until the manifest
contains a valid Aleph `STORE` message hash and the hash resolves through
`https://api2.aleph.im`.

## Browser Signing

Aleph EVM messages are signed with MetaMask `personal_sign` over:

```text
ETH
<sender>
INSTANCE
<item_hash>
```

`item_hash` is the SHA-256 hash of the minified JSON `item_content`, matching
the Python `aleph-client` flow.

## Payment Notes

- `hold`: requires enough unlocked ALEPH and supports standard tiers up to
  tier 3 in the UI.
- `credit`: requires enough Aleph credit balance and a selected CRN node hash.
- Pricing is always fetched live; required amounts are not hardcoded.
