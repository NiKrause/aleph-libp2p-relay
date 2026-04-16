import { EVM_CHAIN_CONFIG } from './config'
import { keccak_256 } from 'js-sha3'
import type { PaymentChain } from './types'

export interface WalletState {
  address: string
  chainId: string | null
  isMetaMask: boolean
}

export function getEthereumProvider(): EthereumProvider | null {
  return globalThis.window?.ethereum ?? null
}

export function toChecksumAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error('Invalid EVM address.')
  }

  const normalized = address.slice(2).toLowerCase()
  const hash = keccak_256(normalized)
  let result = '0x'

  for (let index = 0; index < normalized.length; index += 1) {
    result += Number.parseInt(hash[index], 16) >= 8 ? normalized[index].toUpperCase() : normalized[index]
  }

  return result
}

export async function connectWallet(provider = getEthereumProvider()): Promise<WalletState> {
  if (!provider) throw new Error('MetaMask provider not found.')

  const accounts = await provider.request<string[]>({ method: 'eth_requestAccounts' })
  const chainId = await provider.request<string>({ method: 'eth_chainId' })
  const address = accounts[0]
  if (!address) throw new Error('No wallet account returned.')

  return {
    address: toChecksumAddress(address),
    chainId,
    isMetaMask: Boolean(provider.isMetaMask)
  }
}

export async function switchPaymentChain(chain: PaymentChain, provider = getEthereumProvider()): Promise<void> {
  if (!provider) throw new Error('MetaMask provider not found.')

  const config = EVM_CHAIN_CONFIG[chain]
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: config.chainIdHex }]
    })
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : 0
    if (code !== 4902) throw error

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: config.chainIdHex,
          chainName: config.chainName,
          rpcUrls: config.rpcUrls,
          blockExplorerUrls: config.blockExplorerUrls,
          nativeCurrency: config.nativeCurrency
        }
      ]
    })
  }
}

export async function personalSign(
  address: string,
  message: string,
  provider = getEthereumProvider()
): Promise<string> {
  if (!provider) throw new Error('MetaMask provider not found.')

  const hexMessage = `0x${Array.from(new TextEncoder().encode(message))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`

  return provider.request<string>({
    method: 'personal_sign',
    params: [hexMessage, address]
  })
}
