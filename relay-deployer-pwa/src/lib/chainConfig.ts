import type { PaymentChain } from './types'

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
