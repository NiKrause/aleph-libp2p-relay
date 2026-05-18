# Aleph Relay Deployer PWA

Static Svelte PWA for deploying a prebuilt `py-libp2p` relay VM on Aleph Cloud
directly from the browser. There is no app server.

## What It Does

- Connects MetaMask.
- Loads live Aleph instance pricing, wallet balance, credits, and CRNs.
- Enriches CRN labels with cached GeoIP lookups in browser `localStorage` when
  the CRN list does not already include location metadata.
  The current implementation resolves hostnames through Google DNS-over-HTTPS
  and geolocates the resulting IPs with `country.is`, which is also
  self-hostable later if needed.
- Uses Aleph credits for deployments and selects a compatible CRN.
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

## Prepaid AA Deployments

The PWA now includes an optional prepaid deployment gate for AA-wallet-style
owners. This adds three pieces:

- a deterministic deployment intent hash derived from the Aleph `INSTANCE`
  payload before signing
- an optional onchain prepaid vault flow for `approve`, `deposit`, `reserve`,
  `consume`, and `refundExpired`
- AA wallet assessment in the UI so the app can distinguish between a plain EOA
  soft gate and a contract-backed owner address that may be compatible with hard
  enforcement

Enable the prepaid panel by setting:

```bash
VITE_PREPAID_VAULT_ADDRESS=0xYourVaultAddress
VITE_PREPAID_RESERVATION_TTL_SECONDS=900
```

The checked-in Solidity scaffold lives at
[contracts/PrepaidBudgetVault.sol](/Users/nandi/Projects/aleph-libp2p-relay/relay-deployer-pwa/contracts/PrepaidBudgetVault.sol).
This repo does not currently include a Solidity build pipeline, so treat that
contract as source to deploy with your preferred toolchain.

Important limitation:

- the PWA can gate signing on prepaid reservations
- however, true hard enforcement still depends on Aleph accepting
  contract-based/offchain signature verification for the owner address
- if Aleph only honors classic EOA `personal_sign` in this publish path, the
  prepaid model is a workflow gate rather than a cryptographically final stop

## Rootfs Sources

The deploy form now defaults to `Custom rootfs` whenever
`public/rootfs-manifest.json` is valid. If no valid manifest is present, it
falls back to Aleph-managed base images like Ubuntu 22 and Debian 12.

If you want to use a custom qcow2 rootfs instead, keep using
`public/rootfs-manifest.json` and build/upload the image first:

- if your rootfs contract sets `manifest.copyTarget` to
  `relay-deployer-pwa/public/rootfs-manifest.json`, `rootfs/build-rootfs.sh`
  now syncs the latest and versioned manifest automatically
- otherwise keep the manual copy step below

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
  cd relay-deployer-pwa
  ROOTFS_PROFILE=orbitdb-relay-pinner \
  ORBITDB_RELAY_PINNER_DIR=/Users/nandi/orbitdb-relay-pinner \
  rootfs/build-rootfs.sh
cp dist-rootfs/rootfs-manifest.json public/rootfs-manifest.json
```

To build the `universal-connectivity` Rust peer image instead:

```bash
cd relay-deployer-pwa
export ALEPH_BIN=/Users/nandi/Projects/aleph-libp2p-relay/aleph-client/.venv/bin/aleph
ROOTFS_PROFILE=uc-rust-peer \
UNIVERSAL_CONNECTIVITY_DIR=/Users/nandi/Documents/projekte/DecentraSol/universal-connectivity \
rootfs/build-rootfs.sh
cp dist-rootfs/rootfs-manifest.json public/rootfs-manifest.json
```

To build the `universal-connectivity` Go peer image instead:

```bash
cd relay-deployer-pwa
export ALEPH_BIN=/Users/nandi/Projects/aleph-libp2p-relay/aleph-client/.venv/bin/aleph
ROOTFS_PROFILE=uc-go-peer \
UNIVERSAL_CONNECTIVITY_DIR=/Users/nandi/Documents/projekte/DecentraSol/universal-connectivity \
rootfs/build-rootfs.sh
cp dist-rootfs/rootfs-manifest.json public/rootfs-manifest.json
```

That profile now builds a prebaked image by default. Node.js, production
dependencies, and the `orbitdb-relay-pinner` wrapper are installed into the
qcow2 during the build. The relay service is enabled, but held behind a ready
file until the mapped Aleph host ports are known. Its generated rootfs manifest
version now defaults to the upstream `orbitdb-relay-pinner/package.json`
version unless you override `ROOTFS_VERSION`.

On first boot the image starts a temporary HTTP setup endpoint on internal port
`80`. The PWA automatically calls that endpoint after Aleph reports the mapped
host ports for internal `80`, `9090`, `9091`, `443`, `9093`, and `9094`. The
endpoint then runs
`/usr/local/sbin/orbitdb-relay-pinner-configure.sh`, writes
`VITE_APPEND_ANNOUNCE` plus the external relay/metrics port mapping variables,
creates `/etc/default/orbitdb-relay-pinner.ready`, starts
`orbitdb-relay-pinner.service`, and shuts itself down.

For the OrbitDB profile, the relay's internal WebSocket listener is back on
`9092`, AutoTLS is disabled in the service environment, and the setup step can
append secure `/dns4|/dns6/.../tls/ws` announces for the instance web proxy
hostname so a local Caddy instance can terminate HTTPS/WSS on external `443`.
Those `/tls/ws` multiaddrs now describe the public Caddy-terminated transport,
not relay-side AutoTLS.

The `uc-rust-peer` profile follows the same first-boot setup pattern. It starts
the Rust relay only after Aleph reports the mapped ports, and it can expose a
websocket bridge behind the instance web proxy on `443`. The current Rust peer
still does not self-advertise remapped websocket addresses, so browser clients
should continue to use explicit relay multiaddrs derived from the deployment
metadata when relying on that `443` WSS path.

The `uc-go-peer` profile is simpler: it builds the upstream Go relay directly
into the image without Docker, waits for Aleph’s mapped ports, and then writes
explicit `LIBP2P_ANNOUNCE_ADDRS` values so the node advertises the real public
TCP/WSS/QUIC/WebRTC endpoints. Its WSS transport stays on the mapped external
WS port with native AutoTLS, and a follow-up refresh step can additionally wire
the instance web proxy hostname to internal `443` through Caddy once the exact
secure `libp2p.direct` hostname is known.

That means the checked-in manifest for this profile must include `80/tcp` in
`requiredPortForwards`, and you need to deploy the updated PWA together with a
freshly built OrbitDB rootfs image/manifest pair.

## OrbitDB Runtime Flow

For `orbitdb-relay-pinner`, the PWA now automates four separate steps:

1. Create the Aleph `INSTANCE` message.
2. Publish the Aleph `port-forwarding` aggregate for the required ports from
   `public/rootfs-manifest.json`.
3. Wait until the selected CRN exposes runtime networking details including
   `host_ipv4`, optional public IPv6, and `mapped_ports`.
4. POST the mapped external host ports to the VM setup endpoint at
   `http://HOST_IP:HOST_PORT/configure`.

The setup endpoint then:

- writes `VITE_APPEND_ANNOUNCE`
- creates `/etc/default/orbitdb-relay-pinner.ready`
- starts `orbitdb-relay-pinner.service`
- shuts the temporary setup server down
- when the instance web proxy hostname is known, appends secure
  `/dns4|/dns6/.../tls/ws` announces for that hostname, writes
  `/etc/caddy/Caddyfile`, and starts Caddy so the public HTTPS/WSS front door
  is exposed on `443` and announced on standard proxy port `443`

Important distinction:

- `Runtime: Running` in the PWA means the VM execution is running on the CRN
- it does not guarantee that the relay process inside the VM has already been
  configured and started

For a fresh OrbitDB instance, the relay process is only considered started once
`/etc/default/orbitdb-relay-pinner.ready` exists and `orbitdb-relay-pinner`
listens on ports `9090`, `9091`, `443`, `9093`, `9094`, and optionally `9443`.

## Port Mapping Notes

Aleph instance creation only auto-requests `22/TCP` for SSH. The additional
ports declared in the manifest are added afterward through the separate Aleph
`port-forwarding` aggregate.

For the OrbitDB profile that means the PWA requests:

- `80/TCP` temporary setup endpoint
- `9090/TCP` metrics and health API
- `9091/TCP` libp2p TCP
- `443/TCP` libp2p WebSocket over TLS
- `9093/UDP` WebRTC-direct
- `9094/UDP` QUIC
- `9443/TCP` metrics HTTPS

The Aleph console can show a mapped host port before it is fully reachable from
your browser or network path. In practice this means the setup server can be
listening on internal port `80` while the external host port still refuses
connections for a short time.

## Logging

The relay does not write to a dedicated logfile by default. Logs are captured
by `journald` through systemd. Use:

```bash
journalctl -u orbitdb-relay-pinner -n 200 --no-pager
```

or live tail:

```bash
journalctl -u orbitdb-relay-pinner -f
```

## Troubleshooting

If the PWA shows mapped ports but the relay is still not configured:

1. Check whether the VM setup server is running:

```bash
systemctl status orbitdb-relay-pinner-bootstrap --no-pager -l
ss -ltnp | grep ':80 '
```

2. Test the setup server locally inside the VM:

```bash
curl -v http://127.0.0.1/health
curl -v -X POST http://127.0.0.1/configure \
  -H 'content-type: application/json' \
  --data '{"public_ipv4":"PUBLIC_IP","public_ipv6":"PUBLIC_IPV6","tcp_port":TCP_PORT,"ws_port":WS_PORT,"metrics_port":METRICS_PORT,"metrics_https_port":METRICS_HTTPS_PORT,"webrtc_port":WEBRTC_PORT,"quic_port":QUIC_PORT}'
```

3. Verify that the ready file exists and the relay is actually listening:

```bash
ls -l /etc/default/orbitdb-relay-pinner.ready
systemctl status orbitdb-relay-pinner orbitdb-relay-pinner-bootstrap --no-pager -l
ss -ltnup | grep -E ':(443|9090|9091|9093|9094|9443)\b' || true
```

Known caveat:

- a browser-only direct POST to the temporary external setup port can fail if
  your VPN, split-tunneling rules, or CRN-side reachability prevent access to
  the mapped host port even though the VM itself is healthy
- in that case, local `127.0.0.1` setup inside the VM still works and proves
  the image/configure flow is correct

For the default `py-libp2p` profile you can still force the older fully baked
image path:

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

- Deployments are currently credit-only.
- The PWA always requires enough Aleph credit balance and a selected CRN node hash.
- Pricing is always fetched live; required amounts are not hardcoded.
