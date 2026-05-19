import type {
  AlephBroadcastMessage as SharedAlephBroadcastMessage,
  AlephBroadcastResponse as SharedAlephBroadcastResponse,
  AlephMessageType as SharedAlephMessageType,
  AlephSenderChain as SharedAlephSenderChain,
  BalanceResponse as SharedBalanceResponse,
  ComputeUnit as SharedComputeUnit,
  Crn as SharedCrn,
  CrnListResponse as SharedCrnListResponse,
  CrnLocation as SharedCrnLocation,
  CrnUsage as SharedCrnUsage,
  InstanceAllocation as SharedInstanceAllocation,
  InstanceAllocationNode as SharedInstanceAllocationNode,
  InstanceAllocationPeriod as SharedInstanceAllocationPeriod,
  InstanceExecution as SharedInstanceExecution,
  InstanceExecutionNetworking as SharedInstanceExecutionNetworking,
  InstanceExecutionStatus as SharedInstanceExecutionStatus,
  InstanceMessage as SharedInstanceMessage,
  InstancePortMapping as SharedInstancePortMapping,
  InstancePricing as SharedInstancePricing,
  MessageReference as SharedMessageReference,
  MessageStatus as SharedMessageStatus,
  Price as SharedPrice,
  PricingState as SharedPricingState,
  ReferenceStatus as SharedReferenceStatus,
  RootfsManifest as SharedRootfsManifest,
  RootfsManifestState as SharedRootfsManifestState,
  RootfsRequiredPortForward as SharedRootfsRequiredPortForward,
  RootfsResolution as SharedRootfsResolution,
  Tier as SharedTier
} from '@le-space/browser'
import type {
  PaymentQuote as SharedPaymentQuote,
  TierSpec as SharedTierSpec
} from '@le-space/core'
import type {
  AlephAggregateContent as SharedAlephAggregateContent,
  AlephInstanceContent as SharedAlephInstanceContent,
  DeploymentIntentEnvelope as SharedDeploymentIntentEnvelope
} from '@le-space/shared-types'

export type PaymentMode = 'hold' | 'credit'
export type PaymentChain = 'BASE' | 'AVAX' | 'ETH'
export type AlephSenderChain = SharedAlephSenderChain
export type AlephMessageType = SharedAlephMessageType
export type MessageStatus = SharedMessageStatus
export type ReferenceStatus = SharedReferenceStatus
export type GatewayProbeStatus = 'reachable' | 'timeout' | 'error' | 'unavailable' | 'unknown'
export type RootfsInstallStrategy = 'thin' | 'prebaked'
export type RootfsSourceMode = 'base' | 'custom'
export type AlephBaseRootfs = 'ubuntu22' | 'debian12'

export type RootfsRequiredPortForward = SharedRootfsRequiredPortForward
export type RootfsManifest = SharedRootfsManifest & {
  rootfsItemHash: string
}
export type RootfsManifestState = SharedRootfsManifestState
export type RootfsResolution = SharedRootfsResolution
export type BalanceResponse = SharedBalanceResponse
export type Price = SharedPrice
export type ComputeUnit = SharedComputeUnit
export type Tier = SharedTier
export type InstancePricing = SharedInstancePricing
export type PricingState = SharedPricingState
export type CrnUsage = SharedCrnUsage
export type CrnLocation = SharedCrnLocation
export type Crn = SharedCrn
export type CrnListResponse = SharedCrnListResponse

export type TierSpec = SharedTierSpec

export type PaymentQuote = SharedPaymentQuote

export interface DeploymentForm {
  name: string
  sshPublicKey: string
  rootfsSourceMode: RootfsSourceMode
  baseRootfs: AlephBaseRootfs
  tierId: string
  selectedCrnHash: string
}

export interface DeploymentValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
  quote: PaymentQuote | null
}

export type AAWalletKind = 'eoa' | 'smart-account' | 'delegated-eoa' | 'unknown'
export type PrepaidEnforcementLevel = 'none' | 'soft-gate' | 'contract-signature-ready'

export interface AAWalletAssessment {
  ownerAddress: string
  codeHash: string | null
  hasCode: boolean
  kind: AAWalletKind
  supportsContractSignatures: boolean
  enforcementLevel: PrepaidEnforcementLevel
  warnings: string[]
}

export interface DeploymentIntent {
  ownerAddress: string
  messageTime: number
  itemHash: string
  paymentType: PaymentMode
  rootfsRef: string
  rootfsSizeMiB: number
  computeUnits: number
  vcpus: number
  memoryMiB: number
  crnHash: string | null
  channel: string
  expiresAt: number
  maxCost: string
}

export type DeploymentIntentEnvelope = Omit<SharedDeploymentIntentEnvelope, 'intent'> & {
  intent: DeploymentIntent
}

export interface PrepaidReservation {
  intentHash: string
  ownerAddress: string
  reservedAmount: bigint
  expiresAt: number
  consumed: boolean
  expired: boolean
}

export interface PrepaidVaultState {
  configured: boolean
  chain: PaymentChain | null
  tokenAddress: string | null
  vaultAddress: string | null
  ownerAddress: string | null
  totalDeposited: bigint
  availableBalance: bigint
  reservedBalance: bigint
  currentReservation: PrepaidReservation | null
  enforcementLevel: PrepaidEnforcementLevel
  aaWallet: AAWalletAssessment | null
  warnings: string[]
}

export type AlephInstanceContent = Omit<SharedAlephInstanceContent, 'payment'> & {
  payment: Omit<SharedAlephInstanceContent['payment'], 'chain' | 'type'> & {
    chain?: PaymentChain
    type: PaymentMode
  }
}

export type AlephAggregateContent<T = Record<string, unknown>> = SharedAlephAggregateContent<T>

export interface AlephForgetContent {
  address: string
  time: number
  hashes: string[]
  aggregates?: string[]
  reason?: string
}

export type AlephBroadcastMessage = SharedAlephBroadcastMessage
export type AlephBroadcastResponse = SharedAlephBroadcastResponse
export type MessageReference = SharedMessageReference

export interface DeploymentResult {
  itemHash: string
  status: MessageStatus
  message: AlephBroadcastMessage
  response: AlephBroadcastResponse
  errorCode?: number | null
  rejectionReason?: string | null
  references?: MessageReference[]
  details?: Record<string, unknown> | null
}

export type InstanceAllocationNode = SharedInstanceAllocationNode
export type InstanceAllocationPeriod = SharedInstanceAllocationPeriod
export type InstanceAllocation = SharedInstanceAllocation

export interface PortForwardFlags {
  tcp: boolean
  udp: boolean
}

export interface PortForwardAggregateEntry {
  ports: Record<string, PortForwardFlags>
}

export type PortForwardAggregate = Record<string, PortForwardAggregateEntry>

export type InstancePortMapping = SharedInstancePortMapping
export type InstanceExecutionStatus = SharedInstanceExecutionStatus
export type InstanceExecutionNetworking = SharedInstanceExecutionNetworking
export type InstanceExecution = SharedInstanceExecution

export interface InstanceRuntimeDetails {
  messageStatus: MessageStatus
  allocation: InstanceAllocation | null
  execution: InstanceExecution | null
  webAccessUrl?: string | null
  executionLookupBlocked?: boolean
  error?: string | null
}

export type InstanceMessage = SharedInstanceMessage
