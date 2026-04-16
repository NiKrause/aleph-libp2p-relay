import type { PaymentChain } from './types'

export const ALEPH_API_HOST = 'https://api2.aleph.im'
export const ALEPH_DEFAULT_CHANNEL = 'ALEPH-CLOUDSOLUTIONS'
export const ALEPH_AGGREGATE_ADDRESS = '0xFba561a84A537fCaa567bb7A2257e7142701ae2A'
export const CRN_LIST_URL = 'https://crns-list.aleph.sh/crns.json'
export const ROOTFS_MANIFEST_URL = './rootfs-manifest.json'
export const PRICE_STALE_MS = 5 * 60 * 1000
export const HOLD_MAX_COMPUTE_UNITS = 4
export const DEFAULT_PAYMENT_CHAIN: PaymentChain = 'BASE'

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
