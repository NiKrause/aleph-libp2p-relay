import { ALEPH_BASE_ROOTFS_ITEM_HASHES, ALEPH_API_HOST, ALEPH_DEFAULT_CHANNEL } from './config'
import { broadcastAlephMessage } from './alephApi'
import { sha256Hex } from './crypto'
import { createReleaseMetadata, normalizeSshPublicKey, tierSpec } from './deployment'
import { personalSign } from './wallet'
import type {
  AlephBroadcastMessage,
  AlephInstanceContent,
  Crn,
  DeploymentForm,
  DeploymentResult,
  InstancePricing,
  MessageStatus,
  RootfsManifest,
  Tier
} from './types'

export function createInstanceContent(args: {
  address: string
  form: DeploymentForm
  manifest: RootfsManifest | null
  pricing: InstancePricing
  tier: Tier
  selectedCrn?: Crn | null
  now?: number
}): AlephInstanceContent {
  const spec = tierSpec(args.pricing, args.tier)
  const sshKey = normalizeSshPublicKey(args.form.sshPublicKey)

  const requirements = args.selectedCrn ? { node: { node_hash: args.selectedCrn.hash } } : undefined
  const rootfsRef =
    args.form.rootfsSourceMode === 'base'
      ? ALEPH_BASE_ROOTFS_ITEM_HASHES[args.form.baseRootfs]
      : args.manifest?.rootfsItemHash ?? ''
  const rootfsSizeMiB =
    args.form.rootfsSourceMode === 'base'
      ? spec.diskMiB
      : Math.max(args.manifest?.rootfsSizeMiB ?? spec.diskMiB, spec.diskMiB)
  const rootfsVersion =
    args.form.rootfsSourceMode === 'base'
      ? `aleph-base-${args.form.baseRootfs}`
      : args.manifest?.version ?? 'custom-rootfs'

  const content: AlephInstanceContent = {
    address: args.address,
    time: args.now ?? Date.now() / 1000,
    allow_amend: false,
    metadata: createReleaseMetadata(args.form.name.trim(), rootfsVersion),
    authorized_keys: sshKey ? [sshKey] : undefined,
    environment: {
      internet: true,
      aleph_api: true,
      hypervisor: 'qemu',
      reproducible: false,
      shared_cache: false
    },
    resources: {
      vcpus: spec.vcpus,
      memory: spec.memoryMiB,
      seconds: 30
    },
    payment: {
      type: 'credit'
    },
    requirements,
    volumes: [],
    rootfs: {
      parent: {
        ref: rootfsRef,
        use_latest: true
      },
      persistence: 'host',
      size_mib: rootfsSizeMiB
    }
  }

  return content
}

export async function createUnsignedInstanceMessage(args: {
  sender: string
  content: AlephInstanceContent
  channel?: string
  now?: number
}): Promise<Omit<AlephBroadcastMessage, 'signature'>> {
  const itemContent = JSON.stringify(args.content)
  const itemHash = await sha256Hex(itemContent)

  return {
    sender: args.sender,
    chain: 'ETH',
    type: 'INSTANCE',
    item_hash: itemHash,
    item_type: 'inline',
    item_content: itemContent,
    time: args.now ?? Date.now() / 1000,
    channel: args.channel ?? ALEPH_DEFAULT_CHANNEL
  }
}

export function signaturePayload(message: Pick<AlephBroadcastMessage, 'chain' | 'sender' | 'type' | 'item_hash'>): string {
  return [message.chain, message.sender, message.type, message.item_hash].join('\n')
}

export async function signInstanceMessage(
  unsignedMessage: Omit<AlephBroadcastMessage, 'signature'>,
  signer = personalSign
): Promise<AlephBroadcastMessage> {
  const signature = await signer(unsignedMessage.sender, signaturePayload(unsignedMessage))
  return {
    ...unsignedMessage,
    signature: signature.startsWith('0x') ? signature : `0x${signature}`
  }
}

function normalizeStatus(httpStatus: number, responseStatus: unknown): MessageStatus {
  if (httpStatus === 202) return 'pending'
  if (typeof responseStatus !== 'string') return 'unknown'

  const normalized = responseStatus.toLowerCase()
  if (normalized === 'processed' || normalized === 'pending' || normalized === 'rejected') {
    return normalized
  }
  return 'unknown'
}

function normalizeSdkStatus(error: unknown): MessageStatus {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  if (message.includes('rejected')) return 'rejected'
  return 'unknown'
}

export async function deployInstance(args: {
  sender: string
  form: DeploymentForm
  manifest: RootfsManifest | null
  pricing: InstancePricing
  tier: Tier
  selectedCrn?: Crn | null
  channel?: string
}): Promise<DeploymentResult> {
  const content = createInstanceContent({
    address: args.sender,
    form: args.form,
    manifest: args.manifest,
    pricing: args.pricing,
    tier: args.tier,
    selectedCrn: args.selectedCrn
  })

  try {
    const unsignedMessage = await createUnsignedInstanceMessage({
      sender: args.sender,
      content,
      channel: args.channel ?? ALEPH_DEFAULT_CHANNEL
    })
    const message = await signInstanceMessage(unsignedMessage)
    const { response, httpStatus } = await broadcastAlephMessage(message, ALEPH_API_HOST, false)
    const status = normalizeStatus(httpStatus, response.message_status)

    return {
      itemHash: message.item_hash,
      status,
      message,
      response,
      rejectionReason: status === 'rejected' ? String(response.details ?? 'Aleph rejected this deployment.') : undefined
    }
  } catch (error) {
    const status = normalizeSdkStatus(error)
    return {
      itemHash: '',
      status,
      message: {
        sender: args.sender,
        chain: 'ETH',
        signature: '',
        type: 'INSTANCE',
        item_hash: '',
        item_type: 'inline',
        item_content: JSON.stringify(content),
        time: Date.now() / 1000,
        channel: args.channel ?? ALEPH_DEFAULT_CHANNEL
      },
      response: {
        message_status: status,
        details: error instanceof Error ? error.message : String(error)
      },
      rejectionReason: error instanceof Error ? error.message : String(error)
    }
  }
}
