import {
  createDeploymentIntent as createSharedDeploymentIntent,
  createUnsignedInstanceMessage as createSharedUnsignedInstanceMessage,
  normalizeBroadcastStatus,
  signAlephMessage,
  signaturePayload
} from '@le-space/core'
export { signaturePayload } from '@le-space/core'
import {
  ALEPH_BASE_ROOTFS_ITEM_HASHES,
  ALEPH_API_HOST,
  ALEPH_DEFAULT_CHANNEL,
  PREPAID_RESERVATION_TTL_SECONDS
} from './config'
import { broadcastAlephMessage } from './alephApi'
import { keccak256Hex, sha256Hex } from './crypto'
import { createReleaseMetadata, normalizeSshPublicKey, tierSpec } from './deployment'
import { personalSign } from './wallet'
import type {
  AlephBroadcastMessage,
  AlephInstanceContent,
  Crn,
  DeploymentIntentEnvelope,
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
  return createSharedUnsignedInstanceMessage({
    sender: args.sender,
    content: args.content,
    hasher: sha256Hex,
    channel: args.channel ?? ALEPH_DEFAULT_CHANNEL,
    now: args.now
  })
}

export async function createDeploymentIntent(args: {
  sender: string
  form: DeploymentForm
  manifest: RootfsManifest | null
  pricing: InstancePricing
  tier: Tier
  selectedCrn?: Crn | null
  channel?: string
  quoteRequiredBudget?: bigint
  expiresAt?: number
  now?: number
}): Promise<DeploymentIntentEnvelope> {
  const messageTime = args.now ?? Math.floor(Date.now() / 1000)
  const content = createInstanceContent({
    address: args.sender,
    form: args.form,
    manifest: args.manifest,
    pricing: args.pricing,
    tier: args.tier,
    selectedCrn: args.selectedCrn,
    now: messageTime
  })

  const unsigned = await createUnsignedInstanceMessage({
    sender: args.sender,
    content,
    channel: args.channel ?? ALEPH_DEFAULT_CHANNEL,
    now: messageTime
  })

  const spec = tierSpec(args.pricing, args.tier)
  const expiresAt =
    args.expiresAt ?? Math.floor(Date.now() / 1000) + PREPAID_RESERVATION_TTL_SECONDS
  const maxCost = (args.quoteRequiredBudget ?? 0n).toString(10)
  const envelope = await createSharedDeploymentIntent({
    sender: args.sender,
    unsignedMessage: unsigned,
    content,
    computeUnits: args.tier.compute_units,
    expiresAt,
    maxCost,
    hasher: keccak256Hex
  })

  return {
    intent: {
      ...envelope.intent,
      paymentType: envelope.intent.paymentType as DeploymentIntentEnvelope['intent']['paymentType']
    },
    intentHash: envelope.intentHash
  }
}

export async function signInstanceMessage(
  unsignedMessage: Omit<AlephBroadcastMessage, 'signature'>,
  signer = personalSign
): Promise<AlephBroadcastMessage> {
  return signAlephMessage(unsignedMessage, signer)
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
  now?: number
}): Promise<DeploymentResult> {
  const content = createInstanceContent({
    address: args.sender,
    form: args.form,
    manifest: args.manifest,
    pricing: args.pricing,
    tier: args.tier,
    selectedCrn: args.selectedCrn,
    now: args.now
  })

  try {
    const unsignedMessage = await createUnsignedInstanceMessage({
      sender: args.sender,
      content,
      channel: args.channel ?? ALEPH_DEFAULT_CHANNEL,
      now: args.now
    })
    const message = await signInstanceMessage(unsignedMessage)
    const { response, httpStatus } = await broadcastAlephMessage(message, ALEPH_API_HOST, false)
    const status = normalizeBroadcastStatus(httpStatus, response.message_status)

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
