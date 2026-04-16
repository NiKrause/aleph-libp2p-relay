# Aleph Relay Deployer PWA

Static Svelte PWA for deploying a prebuilt `py-libp2p` relay VM on Aleph Cloud
directly from the browser. There is no app server.

## What It Does

- Connects MetaMask.
- Loads live Aleph instance pricing, wallet balance, credits, and CRNs.
- Offers `hold` and `credit` payment modes.
- Uses a pinned rootfs release manifest from `public/rootfs-manifest.json`.
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

## Rootfs Manifest

`public/rootfs-manifest.json` intentionally starts without a `rootfsItemHash`.
Build and upload the custom rootfs first:

```bash
rootfs/build-rootfs.sh
cp dist-rootfs/rootfs-manifest.json public/rootfs-manifest.json
```

The PWA blocks deployment until the manifest contains a valid Aleph `STORE`
message hash and the hash resolves through `https://api2.aleph.im`.

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
