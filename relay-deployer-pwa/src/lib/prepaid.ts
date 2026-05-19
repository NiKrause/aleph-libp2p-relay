import {
  approvePrepaidBudget as approvePrepaidBudgetShared,
  consumeDeploymentReservation as consumeDeploymentReservationShared,
  depositPrepaidBudget as depositPrepaidBudgetShared,
  formatBudgetUnits as formatBudgetUnitsShared,
  loadPrepaidVaultSnapshot,
  paymentChainFromChainId as paymentChainFromChainIdShared,
  refundExpiredReservation as refundExpiredReservationShared,
  reserveDeploymentBudget as reserveDeploymentBudgetShared
} from '@le-space/browser'
import { ALEPH_TOKEN_CONTRACTS, EVM_CHAIN_CONFIG, PREPAID_TOKEN_DECIMALS, PREPAID_VAULT_ADDRESS } from './config'
import type {
  AAWalletAssessment,
  PaymentChain,
  PrepaidReservation,
  PrepaidVaultState
} from './types'
import { assessAAWallet, getEthereumProvider } from './wallet'

export function prepaidVaultConfigured(): boolean {
  return Boolean(PREPAID_VAULT_ADDRESS)
}

export function paymentChainFromChainId(chainId: string | null): PaymentChain | null {
  return paymentChainFromChainIdShared(chainId, EVM_CHAIN_CONFIG)
}

export function formatBudgetUnits(value: bigint, decimals = PREPAID_TOKEN_DECIMALS): number {
  return formatBudgetUnitsShared(value, decimals)
}

export async function loadPrepaidVaultState(args: {
  ownerAddress: string
  currentIntentHash?: string | null
  aaWallet?: AAWalletAssessment | null
}): Promise<PrepaidVaultState> {
  const chain = paymentChainFromChainId((await getEthereumProvider()?.request<string>({ method: 'eth_chainId' })) ?? null)

  if (!PREPAID_VAULT_ADDRESS || !chain) {
    return {
      configured: false,
      chain,
      tokenAddress: chain ? ALEPH_TOKEN_CONTRACTS[chain] : null,
      vaultAddress: PREPAID_VAULT_ADDRESS || null,
      ownerAddress: args.ownerAddress,
      totalDeposited: 0n,
      availableBalance: 0n,
      reservedBalance: 0n,
      currentReservation: null,
      enforcementLevel: args.aaWallet?.enforcementLevel ?? 'none',
      aaWallet: args.aaWallet ?? null,
      warnings: PREPAID_VAULT_ADDRESS ? ['Prepaid vault is configured, but the connected chain is unsupported or unavailable.'] : []
    }
  }

  const aaWallet = args.aaWallet ?? (await assessAAWallet(args.ownerAddress))
  const snapshot = await loadPrepaidVaultSnapshot({
    ownerAddress: args.ownerAddress,
    currentIntentHash: args.currentIntentHash,
    vaultAddress: PREPAID_VAULT_ADDRESS,
    provider: getEthereumProvider()
  })

  return {
    configured: true,
    chain,
    tokenAddress: ALEPH_TOKEN_CONTRACTS[chain],
    vaultAddress: PREPAID_VAULT_ADDRESS,
    ownerAddress: args.ownerAddress,
    totalDeposited: snapshot.totalDeposited,
    availableBalance: snapshot.availableBalance,
    reservedBalance: snapshot.reservedBalance,
    currentReservation: snapshot.currentReservation as PrepaidReservation | null,
    enforcementLevel: aaWallet.enforcementLevel,
    aaWallet,
    warnings: [...aaWallet.warnings]
  }
}

export async function approvePrepaidBudget(args: {
  ownerAddress: string
  amount: bigint
  chain: PaymentChain
}): Promise<string> {
  return approvePrepaidBudgetShared({
    ownerAddress: args.ownerAddress,
    amount: args.amount,
    tokenAddress: ALEPH_TOKEN_CONTRACTS[args.chain],
    vaultAddress: PREPAID_VAULT_ADDRESS,
    provider: getEthereumProvider()
  })
}

export async function depositPrepaidBudget(args: {
  ownerAddress: string
  amount: bigint
}): Promise<string> {
  return depositPrepaidBudgetShared({
    ownerAddress: args.ownerAddress,
    amount: args.amount,
    vaultAddress: PREPAID_VAULT_ADDRESS,
    provider: getEthereumProvider()
  })
}

export async function reserveDeploymentBudget(args: {
  ownerAddress: string
  intentHash: string
  amount: bigint
  expiresAt: number
}): Promise<string> {
  return reserveDeploymentBudgetShared({
    ownerAddress: args.ownerAddress,
    intentHash: args.intentHash,
    amount: args.amount,
    expiresAt: args.expiresAt,
    vaultAddress: PREPAID_VAULT_ADDRESS,
    provider: getEthereumProvider()
  })
}

export async function consumeDeploymentReservation(args: {
  ownerAddress: string
  intentHash: string
  amount: bigint
}): Promise<string> {
  return consumeDeploymentReservationShared({
    ownerAddress: args.ownerAddress,
    intentHash: args.intentHash,
    amount: args.amount,
    vaultAddress: PREPAID_VAULT_ADDRESS,
    provider: getEthereumProvider()
  })
}

export async function refundExpiredReservation(args: {
  ownerAddress: string
  intentHash: string
}): Promise<string> {
  return refundExpiredReservationShared({
    ownerAddress: args.ownerAddress,
    intentHash: args.intentHash,
    vaultAddress: PREPAID_VAULT_ADDRESS,
    provider: getEthereumProvider()
  })
}
