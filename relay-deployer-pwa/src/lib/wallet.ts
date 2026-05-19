import { ALEPH_TOKEN_CONTRACTS, EVM_CHAIN_CONFIG, PREPAID_VAULT_ADDRESS } from './config'
import { ethCall, personalSign, sendTransaction } from '@le-space/browser'
import { fetchWithTimeout } from './http'
import { keccak_256 } from 'js-sha3'
import type { AAWalletAssessment, PaymentChain, PrepaidEnforcementLevel } from './types'

export interface WalletState {
  address: string
  chainId: string | null
  isMetaMask: boolean
}

export function getEthereumProvider(): EthereumProvider | null {
  return globalThis.window?.ethereum ?? null
}

function hexToDecimalString(value: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`Invalid hex value returned by RPC: ${value}`)
  }

  return BigInt(value).toString(10)
}

function formatTokenUnits(rawValue: bigint, decimals = 18): number {
  const divisor = 10n ** BigInt(decimals)
  const whole = rawValue / divisor
  const fraction = rawValue % divisor

  return Number(whole) + Number(fraction) / 10 ** decimals
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

function normalizeHex(value: string): `0x${string}` {
  const normalized = value.startsWith('0x') ? value.toLowerCase() : `0x${value.toLowerCase()}`
  return normalized as `0x${string}`
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

export async function fetchAlephTokenBalance(address: string, chain: PaymentChain): Promise<number> {
  const config = EVM_CHAIN_CONFIG[chain]
  const contract = ALEPH_TOKEN_CONTRACTS[chain]
  const callData = `0x70a08231000000000000000000000000${address.slice(2).toLowerCase()}`

  const response = await fetchWithTimeout(
    config.rpcUrls[0],
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [
          {
            to: contract,
            data: callData
          },
          'latest'
        ]
      })
    },
    10000
  )

  if (!response.ok) {
    throw new Error(`Selected-chain balance request failed: ${response.status}`)
  }

  const payload = (await response.json()) as { result?: string; error?: { message?: string } }
  if (payload.error?.message) {
    throw new Error(payload.error.message)
  }
  if (!payload.result) {
    throw new Error('Selected-chain balance request returned no result.')
  }

  return formatTokenUnits(BigInt(hexToDecimalString(payload.result)))
}

export async function getContractCode(
  address: string,
  provider = getEthereumProvider()
): Promise<string> {
  if (!provider) throw new Error('MetaMask provider not found.')

  return provider.request<string>({
    method: 'eth_getCode',
    params: [address, 'latest']
  })
}

export async function ethCallLocal(
  to: string,
  data: `0x${string}`,
  provider = getEthereumProvider()
): Promise<string> {
  return ethCall(to, data, provider)
}

export async function sendTransactionLocal(
  tx: {
    from: string
    to: string
    data?: `0x${string}`
    value?: bigint
  },
  provider = getEthereumProvider()
): Promise<string> {
  return sendTransaction(tx, provider)
}

export async function assessAAWallet(
  address: string,
  provider = getEthereumProvider()
): Promise<AAWalletAssessment> {
  const code = await getContractCode(address, provider)
  const normalizedCode = normalizeHex(code)
  const hasCode = normalizedCode !== '0x'

  let kind: AAWalletAssessment['kind'] = 'unknown'
  let enforcementLevel: PrepaidEnforcementLevel = 'none'
  const warnings: string[] = []

  if (!hasCode) {
    kind = 'eoa'
    enforcementLevel = 'soft-gate'
    warnings.push('Connected address has no deployed code. ERC-4337-style hard enforcement is not available on this address.')
    warnings.push('EIP-7702 may still enable delegated code execution, but this PWA cannot prove that Aleph will enforce it for offchain message signatures.')
  } else {
    kind = 'smart-account'
    enforcementLevel = PREPAID_VAULT_ADDRESS ? 'contract-signature-ready' : 'soft-gate'
    warnings.push('Connected address has deployed code. This looks compatible with a smart-account flow, but Aleph contract-signature support still needs upstream validation.')
  }

  return {
    ownerAddress: address,
    codeHash: hasCode ? normalizedCode : null,
    hasCode,
    kind,
    supportsContractSignatures: hasCode,
    enforcementLevel,
    warnings
  }
}

export function parseUint256Hex(value: string): bigint {
  const normalized = normalizeHex(value)
  if (!/^0x[0-9a-f]+$/i.test(normalized)) {
    throw new Error(`Invalid uint256 hex value: ${value}`)
  }

  return BigInt(normalized)
}

export async function personalSignLocal(
  address: string,
  message: string,
  provider = getEthereumProvider()
): Promise<string> {
  return personalSign(address, message, provider)
}

export { ethCallLocal as ethCall, personalSignLocal as personalSign, sendTransactionLocal as sendTransaction }
