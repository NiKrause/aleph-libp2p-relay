import {
  DEFAULT_INSTANCE_PORT_FORWARDS,
  ensureInstancePortForwards as ensureSharedInstancePortForwards,
  fetchPortForwardAggregate,
  mergeRequiredPortForwards,
  portForwardLabel,
  requiredInstancePortForwards
} from '@le-space/core'
import type { RootfsManifest as SharedRootfsManifest } from '@le-space/shared-types'
import { ALEPH_API_HOST, ALEPH_DEFAULT_CHANNEL } from './alephConfig'
import { fetchWithTimeout } from './http'
import { sha256Hex } from './crypto'
import { personalSign } from './wallet'
import type {
  MessageStatus,
  PortForwardAggregate,
  RootfsManifest,
  RootfsRequiredPortForward
} from './types'

export {
  DEFAULT_INSTANCE_PORT_FORWARDS,
  fetchPortForwardAggregate,
  mergeRequiredPortForwards,
  portForwardLabel,
  requiredInstancePortForwards
}

export async function ensureInstancePortForwards(args: {
  sender: string
  instanceItemHash: string
  manifest: RootfsManifest | null
  channel?: string
  apiHost?: string
  signer?: typeof personalSign
}): Promise<{
  aggregateItemHash: string
  aggregateStatus: MessageStatus
  requestedPorts: RootfsRequiredPortForward[]
}> {
  const result = await ensureSharedInstancePortForwards({
    sender: args.sender,
    instanceItemHash: args.instanceItemHash,
    manifest: args.manifest as SharedRootfsManifest | null,
    signer: args.signer ?? personalSign,
    hasher: sha256Hex,
    fetch: fetchWithTimeout,
    channel: args.channel ?? ALEPH_DEFAULT_CHANNEL,
    apiHost: args.apiHost ?? ALEPH_API_HOST,
    sync: false
  })

  return {
    ...result,
    aggregateStatus: result.aggregateStatus === 'unknown' ? 'processed' : result.aggregateStatus
  }
}

export type { PortForwardAggregate }
