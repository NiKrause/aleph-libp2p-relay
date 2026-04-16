export type PaymentMode = 'hold' | 'credit'
export type PaymentChain = 'BASE' | 'AVAX' | 'ETH'
export type AlephSenderChain = 'ETH'
export type MessageStatus = 'processed' | 'pending' | 'rejected' | 'unknown'

export interface RootfsManifest {
  version: string
  rootfsItemHash: string
  rootfsSizeMiB: number
  createdAt: string
  notes?: string
}

export interface RootfsManifestState {
  manifest: RootfsManifest | null
  valid: boolean
  errors: string[]
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
    hypervisor: 'qemu'
    reproducible: boolean
    shared_cache: boolean
  }
  resources: {
    vcpus: number
    memory: number
    seconds: number
  }
  payment: {
    chain?: PaymentChain
    receiver: string | null
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
      use_latest: boolean
    }
    persistence: 'host'
    size_mib: number
  }
}

export interface AlephBroadcastMessage {
  sender: string
  chain: AlephSenderChain
  signature: string
  type: 'INSTANCE'
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

export interface DeploymentResult {
  itemHash: string
  status: MessageStatus
  message: AlephBroadcastMessage
  response: AlephBroadcastResponse
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
  confirmed?: boolean
}
