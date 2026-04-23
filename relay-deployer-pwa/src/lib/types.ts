export type PaymentMode = 'hold' | 'credit'
export type PaymentChain = 'BASE' | 'AVAX' | 'ETH'
export type AlephSenderChain = 'ETH'
export type AlephMessageType = 'INSTANCE' | 'FORGET'
export type MessageStatus = 'processed' | 'pending' | 'rejected' | 'unknown'
export type ReferenceStatus = MessageStatus | 'missing'
export type GatewayProbeStatus = 'reachable' | 'timeout' | 'error' | 'unavailable' | 'unknown'
export type RootfsInstallStrategy = 'thin' | 'prebaked'
export type RootfsSourceMode = 'base' | 'custom'
export type AlephBaseRootfs = 'ubuntu22' | 'debian12'

export interface RootfsManifest {
  profile?: string
  version: string
  rootfsInstallStrategy?: RootfsInstallStrategy
  requiresBootstrapNetwork?: boolean
  bootstrapSummary?: string
  rootfsItemHash: string
  rootfsSizeMiB: number
  rootfsSourceSizeBytes?: number
  createdAt: string
  notes?: string
}

export interface RootfsManifestState {
  manifest: RootfsManifest | null
  valid: boolean
  errors: string[]
}

export interface RootfsResolution {
  itemHash: string
  messageStatus: MessageStatus
  messageType: string | null
  cid: string | null
  receptionTime?: string | null
  gatewayUrl: string | null
  gatewayStatus: GatewayProbeStatus
  gatewayError?: string | null
}

export interface BalanceResponse {
  address: string
  balance: string
  locked_amount: string
  details?: Record<string, string>
  credit_balance: number
}

export interface Price {
  payg?: string | number | null
  holding?: string | number | null
  fixed?: string | number | null
  credit?: string | number | null
}

export interface ComputeUnit {
  vcpus: number
  memory_mib: number
  disk_mib: number
}

export interface Tier {
  id: string
  compute_units: number
  vram?: number | null
  model?: string | null
}

export interface InstancePricing {
  price: {
    storage?: Price
    compute_unit?: Price
  }
  compute_unit: ComputeUnit
  tiers: Tier[]
}

export interface PricingState {
  pricing: InstancePricing | null
  fetchedAt: number | null
}

export interface CrnUsage {
  cpu?: { count?: number }
  mem?: { available_kB?: number }
  disk?: { available_kB?: number }
  active?: boolean
}

export interface CrnLocation {
  city?: string | null
  region?: string | null
  country?: string | null
  country_code?: string | null
}

export interface Crn {
  hash: string
  name: string
  address: string
  qemu_support?: boolean
  confidential_support?: boolean
  gpu_support?: boolean
  system_usage?: CrnUsage | null
  payment_receiver_address?: string | null
  version?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  country_code?: string | null
  location?: CrnLocation | string | null
}

export interface CrnListResponse {
  crns: Crn[]
}

export interface TierSpec {
  vcpus: number
  memoryMiB: number
  diskMiB: number
}

export interface PaymentQuote {
  mode: PaymentMode
  required: number
  available: number
  computeUnits: number
  unitPrice: number
  label: 'ALEPH held' | 'credits'
}

export interface DeploymentForm {
  name: string
  sshPublicKey: string
  paymentMode: PaymentMode
  paymentChain: PaymentChain
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

export interface AlephInstanceContent {
  address: string
  time: number
  allow_amend: boolean
  metadata?: { name: string; [key: string]: string | number | boolean }
  authorized_keys?: string[]
  environment: {
    internet: boolean
    aleph_api: boolean
    reproducible?: boolean
    shared_cache?: boolean
    hypervisor: 'qemu'
    trusted_execution?: Record<string, unknown>
  }
  resources: {
    vcpus: number
    memory: number
    seconds: number
  }
  payment: {
    chain?: PaymentChain
    receiver?: string
    type: PaymentMode
  }
  requirements?: {
    node?: {
      node_hash: string
    }
  }
  volumes: unknown[]
  rootfs: {
    parent: {
      ref: string
      use_latest?: boolean
    }
    persistence: 'host' | 'store'
    size_mib: number
  }
}

export interface AlephForgetContent {
  address: string
  time: number
  hashes: string[]
  aggregates: string[]
  reason?: string
}

export interface AlephBroadcastMessage {
  sender: string
  chain: AlephSenderChain
  signature: string
  type: AlephMessageType
  item_hash: string
  item_type: 'inline'
  item_content: string
  time: number
  channel: string
}

export interface AlephBroadcastResponse {
  publication_status?: {
    status: string
    failed?: unknown[]
  }
  message_status?: MessageStatus
  [key: string]: unknown
}

export interface MessageReference {
  itemHash: string
  status: ReferenceStatus
  type: string | null
}

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

export interface InstanceAllocationNode {
  node_id?: string
  url?: string
  ipv6?: string | null
  supports_ipv6?: boolean
}

export interface InstanceAllocationPeriod {
  start_timestamp?: string
  duration_seconds?: number
}

export interface InstanceAllocation {
  source: 'scheduler' | 'manual'
  crnHash?: string | null
  crnUrl?: string | null
  node?: InstanceAllocationNode | null
  vmIpv6?: string | null
  period?: InstanceAllocationPeriod | null
}

export interface InstancePortMapping {
  host?: number
  tcp?: boolean
  udp?: boolean
}

export interface InstanceExecutionStatus {
  defined_at?: string | null
  preparing_at?: string | null
  prepared_at?: string | null
  starting_at?: string | null
  started_at?: string | null
  stopping_at?: string | null
  stopped_at?: string | null
}

export interface InstanceExecutionNetworking {
  ipv4?: string | null
  ipv6?: string | null
  ipv4_network?: string | null
  host_ipv4?: string | null
  ipv6_network?: string | null
  ipv6_ip?: string | null
  ipv4_ip?: string | null
  mapped_ports?: Record<string, InstancePortMapping>
}

export interface InstanceExecution {
  crnUrl: string
  version: 'v1' | 'v2'
  running?: boolean
  networking: InstanceExecutionNetworking
  status?: InstanceExecutionStatus | null
}

export interface InstanceRuntimeDetails {
  messageStatus: MessageStatus
  allocation: InstanceAllocation | null
  execution: InstanceExecution | null
  error?: string | null
}

export interface InstanceMessage {
  item_hash: string
  sender: string
  chain: string
  type: 'INSTANCE'
  channel?: string
  content?: {
    metadata?: { name?: string }
    payment?: { type?: PaymentMode; chain?: string }
    rootfs?: { parent?: { ref?: string }; size_mib?: number }
    requirements?: { node?: { node_hash?: string } }
  }
  time?: string | number
  reception_time?: string
  confirmed?: boolean
  status?: string
}
