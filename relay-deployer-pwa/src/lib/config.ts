import type { AlephBaseRootfs, PaymentChain } from './types'

export const ALEPH_API_HOST = 'https://api2.aleph.im'
export const ALEPH_DEFAULT_CHANNEL = 'ALEPH-CLOUDSOLUTIONS'
export const ALEPH_AGGREGATE_ADDRESS = '0xFba561a84A537fCaa567bb7A2257e7142701ae2A'
export const CRN_LIST_URL = 'https://crns-list.aleph.sh/crns.json'
export const ROOTFS_MANIFEST_URL = './rootfs-manifest.json'
export const IPFS_GATEWAY_BASE_URL = 'https://ipfs.aleph.cloud/ipfs/'
export const ALEPH_INSTANCE_DOCS_URL = 'https://docs.aleph.cloud/devhub/sdks-and-tools/aleph-cli/commands/instance.html'
export const PRICE_STALE_MS = 5 * 60 * 1000
export const DEFAULT_BASE_ROOTFS: AlephBaseRootfs = 'ubuntu22'

export const ALEPH_BASE_ROOTFS_OPTIONS: Array<{
  id: AlephBaseRootfs
  label: string
  summary: string
}> = [
  {
    id: 'ubuntu22',
    label: 'Ubuntu 22',
    summary: 'Aleph-managed default Ubuntu 22 base image.'
  },
  {
    id: 'debian12',
    label: 'Debian 12',
    summary: 'Aleph-managed Debian 12 Bookworm base image.'
  }
]

export const ALEPH_BASE_ROOTFS_ITEM_HASHES: Record<AlephBaseRootfs, string> = {
  ubuntu22: '4a0f62da42f4478544616519e6f5d58adb1096e069b392b151d47c3609492d0c',
  debian12: 'b6ff5c3a8205d1ca4c7c3369300eeafff498b558f71b851aa2114afd0a532717'
}

export const EVM_CHAIN_CONFIG: Record<
  PaymentChain,
  {
    alephChain: PaymentChain
    chainIdHex: `0x${string}`
    chainName: string
    rpcUrls: string[]
    blockExplorerUrls: string[]
    nativeCurrency: { name: string; symbol: string; decimals: number }
  }
> = {
  BASE: {
    alephChain: 'BASE',
    chainIdHex: '0x2105',
    chainName: 'Base',
    rpcUrls: ['https://mainnet.base.org'],
    blockExplorerUrls: ['https://basescan.org'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
  },
  AVAX: {
    alephChain: 'AVAX',
    chainIdHex: '0xa86a',
    chainName: 'Avalanche C-Chain',
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc'],
    blockExplorerUrls: ['https://snowtrace.io'],
    nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 }
  },
  ETH: {
    alephChain: 'ETH',
    chainIdHex: '0x1',
    chainName: 'Ethereum Mainnet',
    rpcUrls: ['https://ethereum.publicnode.com'],
    blockExplorerUrls: ['https://etherscan.io'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }
  }
}

export const ALEPH_TOKEN_CONTRACTS: Record<PaymentChain, `0x${string}`> = {
  ETH: '0x27702a26126e0b3702af63ee09ac4d1a084ef628',
  AVAX: '0xc0Fbc4967259786C743361a5885ef49380473dCF',
  BASE: '0xc0Fbc4967259786C743361a5885ef49380473dCF'
}
