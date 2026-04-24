import { ALEPH_API_HOST, ALEPH_DEFAULT_CHANNEL } from './config'
import { normalizeMessageStatus, broadcastAlephMessage } from './alephApi'
import { sha256Hex } from './crypto'
import { fetchWithTimeout } from './http'
import { signaturePayload } from './alephMessage'
import { personalSign } from './wallet'
import type {
  AlephAggregateContent,
  AlephBroadcastMessage,
  MessageStatus,
  PortForwardAggregate,
  PortForwardAggregateEntry,
  PortForwardFlags,
  RootfsManifest,
  RootfsRequiredPortForward
} from './types'

export const DEFAULT_INSTANCE_PORT_FORWARDS: RootfsRequiredPortForward[] = [
  { port: 22, tcp: true, udp: false, purpose: 'SSH' }
]

function normalizeRequestedPort(entry: RootfsRequiredPortForward): RootfsRequiredPortForward {
  return {
    port: entry.port,
    tcp: entry.tcp === true,
    udp: entry.udp === true,
    purpose: entry.purpose?.trim() || undefined
  }
}

function normalizePortFlags(value: unknown): PortForwardFlags | null {
  if (!value || typeof value !== 'object') return null

  const candidate = value as { tcp?: unknown; udp?: unknown }
  return {
    tcp: candidate.tcp === true,
    udp: candidate.udp === true
  }
}

function normalizeExistingEntry(entry: PortForwardAggregateEntry | null | undefined): Record<string, PortForwardFlags> {
  if (!entry?.ports || typeof entry.ports !== 'object') return {}

  return Object.fromEntries(
    Object.entries(entry.ports)
      .map(([port, flags]) => [port, normalizePortFlags(flags)] as const)
      .filter((entry): entry is [string, PortForwardFlags] => entry[1] != null)
  )
}

function requestedPortFlags(
  portForwards: ReadonlyArray<RootfsRequiredPortForward>
): Record<string, PortForwardFlags> {
  return Object.fromEntries(
    portForwards.map((entry) => [
      String(entry.port),
      {
        tcp: entry.tcp === true,
        udp: entry.udp === true
      }
    ])
  )
}

function mergePortFlagMaps(
  existing: Record<string, PortForwardFlags>,
  requested: Record<string, PortForwardFlags>
): Record<string, PortForwardFlags> {
  const merged = new Map<string, PortForwardFlags>()

  for (const [port, flags] of Object.entries(existing)) {
    merged.set(port, {
      tcp: flags.tcp === true,
      udp: flags.udp === true
    })
  }

  for (const [port, flags] of Object.entries(requested)) {
    const current = merged.get(port)
    merged.set(port, {
      tcp: current?.tcp === true || flags.tcp === true,
      udp: current?.udp === true || flags.udp === true
    })
  }

  return Object.fromEntries([...merged.entries()].sort((left, right) => Number(left[0]) - Number(right[0])))
}

function normalizeBroadcastStatus(httpStatus: number, responseStatus: unknown): MessageStatus {
  if (httpStatus === 202) return 'pending'

  const normalized = normalizeMessageStatus(responseStatus)
  return normalized === 'unknown' ? 'processed' : normalized
}

async function createUnsignedAggregateMessage(args: {
  sender: string
  content: AlephAggregateContent<PortForwardAggregate>
  channel?: string
  now?: number
}): Promise<Omit<AlephBroadcastMessage, 'signature'>> {
  const itemContent = JSON.stringify(args.content)
  const itemHash = await sha256Hex(itemContent)

  return {
    sender: args.sender,
    chain: 'ETH',
    type: 'AGGREGATE',
    item_hash: itemHash,
    item_type: 'inline',
    item_content: itemContent,
    time: args.now ?? Date.now() / 1000,
    channel: args.channel ?? ALEPH_DEFAULT_CHANNEL
  }
}

async function signAggregateMessage(
  unsignedMessage: Omit<AlephBroadcastMessage, 'signature'>,
  signer = personalSign
): Promise<AlephBroadcastMessage> {
  const signature = await signer(unsignedMessage.sender, signaturePayload(unsignedMessage))
  return {
    ...unsignedMessage,
    signature: signature.startsWith('0x') ? signature : `0x${signature}`
  }
}

export function mergeRequiredPortForwards(
  ...groups: Array<ReadonlyArray<RootfsRequiredPortForward> | undefined>
): RootfsRequiredPortForward[] {
  const merged = new Map<number, RootfsRequiredPortForward>()

  for (const group of groups) {
    for (const entry of group ?? []) {
      const normalized = normalizeRequestedPort(entry)
      const current = merged.get(normalized.port)
      merged.set(normalized.port, {
        port: normalized.port,
        tcp: current?.tcp === true || normalized.tcp === true,
        udp: current?.udp === true || normalized.udp === true,
        purpose: current?.purpose ?? normalized.purpose
      })
    }
  }

  return [...merged.values()].sort((left, right) => left.port - right.port)
}

export function requiredInstancePortForwards(manifest: RootfsManifest | null): RootfsRequiredPortForward[] {
  return mergeRequiredPortForwards(DEFAULT_INSTANCE_PORT_FORWARDS, manifest?.requiredPortForwards)
}

export function portForwardLabel(entry: RootfsRequiredPortForward): string {
  const protocols = [entry.tcp === true ? 'TCP' : null, entry.udp === true ? 'UDP' : null]
    .filter((value): value is string => Boolean(value))
    .join('/')

  return `${entry.port}/${protocols}`
}

export async function fetchPortForwardAggregate(
  address: string,
  apiHost = ALEPH_API_HOST
): Promise<PortForwardAggregate> {
  const requestUrl = new URL(`/api/v0/aggregates/${address}.json`, apiHost)
  requestUrl.searchParams.set('keys', 'port-forwarding')

  const response = await fetchWithTimeout(requestUrl, { cache: 'no-cache' })
  if (response.status === 404) return {}
  if (!response.ok) {
    throw new Error(`Port-forward aggregate request failed: ${response.status}`)
  }

  const payload = (await response.json()) as { data?: Record<string, unknown> }
  const aggregate = payload.data?.['port-forwarding']
  if (!aggregate || typeof aggregate !== 'object' || Array.isArray(aggregate)) return {}

  return aggregate as PortForwardAggregate
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
  const requestedPorts = requiredInstancePortForwards(args.manifest)
  const apiHost = args.apiHost ?? ALEPH_API_HOST
  const aggregate = await fetchPortForwardAggregate(args.sender, apiHost)
  const existingPorts = normalizeExistingEntry(aggregate[args.instanceItemHash])
  const mergedPorts = mergePortFlagMaps(existingPorts, requestedPortFlags(requestedPorts))

  const content: AlephAggregateContent<PortForwardAggregate> = {
    address: args.sender,
    key: 'port-forwarding',
    content: {
      [args.instanceItemHash]: {
        ports: mergedPorts
      }
    },
    time: Date.now() / 1000
  }

  const unsignedMessage = await createUnsignedAggregateMessage({
    sender: args.sender,
    content,
    channel: args.channel
  })
  const message = await signAggregateMessage(unsignedMessage, args.signer ?? personalSign)
  const { response, httpStatus } = await broadcastAlephMessage(message, apiHost, false)
  const aggregateStatus = normalizeBroadcastStatus(httpStatus, response.message_status)

  if (aggregateStatus === 'rejected') {
    throw new Error(`Port-forward aggregate was rejected by Aleph: ${JSON.stringify(response.details ?? response)}`)
  }

  return {
    aggregateItemHash: message.item_hash,
    aggregateStatus,
    requestedPorts
  }
}
