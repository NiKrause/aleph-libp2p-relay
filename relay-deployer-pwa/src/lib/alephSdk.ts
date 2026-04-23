import { AlephHttpClient, AuthenticatedAlephHttpClient } from '@aleph-sdk/client'
import { Blockchain } from '@aleph-sdk/core'
import { getAccountFromProvider } from '@aleph-sdk/ethereum'
import { findChainDataByChainId } from '@aleph-sdk/evm'
import { ItemType, PaymentType } from '@aleph-sdk/message'
import { ALEPH_API_HOST } from './config'
import { getEthereumProvider } from './wallet'
import type { PaymentChain, PaymentMode } from './types'

export function createAlephHttpClient(apiHost = ALEPH_API_HOST): AlephHttpClient {
  return new AlephHttpClient(apiHost)
}

export async function createAuthenticatedAlephHttpClient(
  provider = getEthereumProvider(),
  apiHost = ALEPH_API_HOST
): Promise<AuthenticatedAlephHttpClient> {
  if (!provider) throw new Error('MetaMask provider not found.')

  const chainIdHex = await provider.request<string>({ method: 'eth_chainId' })
  const chainId = Number.parseInt(chainIdHex, 16)
  const requestedRpc = Number.isFinite(chainId) ? findChainDataByChainId(chainId) : undefined
  const account = await getAccountFromProvider(provider, requestedRpc)

  return new AuthenticatedAlephHttpClient(account, apiHost)
}

export function toSdkBlockchain(chain: PaymentChain): Blockchain {
  return Blockchain[chain]
}

export function toSdkPaymentType(mode: PaymentMode): PaymentType {
  if (mode === 'hold') return PaymentType.hold
  if (mode === 'credit') return PaymentType.credit
  return PaymentType.superfluid
}

export function inlineStorageEngine(): ItemType.inline {
  return ItemType.inline
}
