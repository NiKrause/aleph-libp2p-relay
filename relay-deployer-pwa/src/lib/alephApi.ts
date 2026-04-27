import { ALEPH_API_HOST, CRN_LIST_URL } from './config'
import { fetchWithTimeout } from './http'
import type {
  AlephBroadcastMessage,
  AlephBroadcastResponse,
  BalanceResponse,
  Crn,
  CrnListResponse,
  InstanceAllocation,
  InstanceExecution,
  InstanceMessage,
  InstanceRuntimeDetails,
  MessageReference,
  MessageStatus
} from './types'

type MessageEnvelope = {
  status?: unknown
  type?: unknown
  error_code?: unknown
  details?: unknown
  message?: { type?: unknown } | null
  messages?: Array<{ type?: unknown }> | null
}

type SchedulerAllocationPayload = {
  vm_hash?: unknown
  vm_ipv6?: unknown
  period?: {
    start_timestamp?: unknown
    duration_seconds?: unknown
  } | null
  node?: {
    node_id?: unknown
    url?: unknown
    ipv6?: unknown
    supports_ipv6?: unknown
  } | null
}

type CrnExecutionV1Payload = {
  networking?: {
    ipv4?: unknown
    ipv6?: unknown
  } | null
}

type CrnExecutionV2Payload = {
  networking?: {
    ipv4_network?: unknown
    host_ipv4?: unknown
    ipv6_network?: unknown
    ipv6_ip?: unknown
    ipv4_ip?: unknown
    mapped_ports?: Record<string, { host?: unknown; tcp?: unknown; udp?: unknown }> | null
  } | null
  status?: {
    defined_at?: unknown
    preparing_at?: unknown
    prepared_at?: unknown
    starting_at?: unknown
    started_at?: unknown
    stopping_at?: unknown
    stopped_at?: unknown
  } | null
  running?: unknown
}

type CrnExecutionMapPayload = Record<string, CrnExecutionV1Payload | CrnExecutionV2Payload>

type CrnExecutionLookupResult = {
  payload: CrnExecutionMapPayload | null
  blocked: boolean
}

function isUnconfirmedNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return error instanceof TypeError || message.includes('Failed to fetch') || message.includes('Request timed out')
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeMessageStatus(status: unknown): MessageStatus {
  if (typeof status !== 'string') return 'unknown'

  const normalized = status.toLowerCase()
  if (normalized === 'processed' || normalized === 'pending' || normalized === 'rejected') {
    return normalized
  }

  return 'unknown'
}

function messageTypeFromEnvelope(payload: MessageEnvelope | null): string | null {
  if (!payload) return null

  const type =
    payload.type ??
    payload.message?.type ??
    (Array.isArray(payload.messages) ? payload.messages[0]?.type : undefined)

  return typeof type === 'string' ? type.toUpperCase() : null
}

function extractReferenceHashes(details: unknown): string[] {
  if (!details || typeof details !== 'object' || !('errors' in details)) return []

  const errors = (details as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return []

  return errors.filter((value): value is string => typeof value === 'string')
}

function describeRejectedDeployment(
  payload: MessageEnvelope,
  references: MessageReference[],
  rootfsRef?: string
): string {
  const errorCode = typeof payload.error_code === 'number' ? payload.error_code : null
  const pendingReferences = references.filter((reference) => reference.status === 'pending')
  const missingReferences = references.filter((reference) => reference.status === 'missing')
  const rootfsReference = references.find((reference) => reference.itemHash === rootfsRef)

  if (rootfsReference?.status === 'pending') {
    return `Aleph rejected this deployment because the referenced rootfs STORE message ${rootfsReference.itemHash} is still pending and cannot yet be used by an instance. Wait for that STORE message to process, then deploy again.`
  }

  if (pendingReferences.length > 0) {
    return `Aleph rejected this deployment because referenced message(s) are still pending: ${pendingReferences.map((reference) => reference.itemHash).join(', ')}.`
  }

  if (missingReferences.length > 0) {
    return `Aleph rejected this deployment because referenced message(s) were not found on Aleph: ${missingReferences.map((reference) => reference.itemHash).join(', ')}.`
  }

  const referencedHashes = extractReferenceHashes(payload.details)
  if (referencedHashes.length > 0) {
    return `Aleph rejected this deployment${errorCode ? ` (error ${errorCode})` : ''}. Referenced message(s): ${referencedHashes.join(', ')}.`
  }

  return `Aleph rejected this deployment${errorCode ? ` (error ${errorCode})` : ''}.`
}

export async function fetchBalance(address: string, apiHost = ALEPH_API_HOST): Promise<BalanceResponse> {
  const response = await fetchWithTimeout(`${apiHost}/api/v0/addresses/${address}/balance`, {
    cache: 'no-cache'
  })

  if (!response.ok) throw new Error(`Balance request failed: ${response.status}`)
  return (await response.json()) as BalanceResponse
}

export async function fetchCrns(url = CRN_LIST_URL): Promise<Crn[]> {
  const requestUrl = new URL(url)
  requestUrl.searchParams.set('filter_inactive', 'true')

  const response = await fetchWithTimeout(requestUrl, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`CRN list request failed: ${response.status}`)

  const payload = (await response.json()) as CrnListResponse
  return payload.crns ?? []
}

export async function fetchInstances(address: string, apiHost = ALEPH_API_HOST): Promise<InstanceMessage[]> {
  const url = new URL('/api/v0/messages.json', apiHost)
  url.searchParams.set('msgTypes', 'INSTANCE')
  url.searchParams.set('addresses', address)
  url.searchParams.set('message_statuses', 'processed,pending,rejected,removing')
  url.searchParams.set('pagination', '100')
  url.searchParams.set('page', '1')
  url.searchParams.set('sortOrder', '-1')

  const response = await fetchWithTimeout(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`Instance list request failed: ${response.status}`)

  const payload = (await response.json()) as { messages?: InstanceMessage[] }
  return (payload.messages ?? []).map((message) => ({
    ...message,
    status: typeof message.status === 'string' && message.status.trim() ? message.status : message.confirmed ? 'processed' : message.status
  }))
}

async function fetchSchedulerAllocation(itemHash: string): Promise<InstanceAllocation | null> {
  const response = await fetchWithTimeout(`https://scheduler.api.aleph.cloud/api/v0/allocation/${itemHash}`, {
    cache: 'no-cache'
  })

  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Scheduler allocation request failed: ${response.status}`)

  const payload = (await response.json()) as SchedulerAllocationPayload
  const node = payload.node

  return {
    source: 'scheduler',
    crnUrl: asString(node?.url),
    node: node
      ? {
          node_id: asString(node.node_id) ?? undefined,
          url: asString(node.url) ?? undefined,
          ipv6: asString(node.ipv6),
          supports_ipv6: typeof node.supports_ipv6 === 'boolean' ? node.supports_ipv6 : undefined
        }
      : null,
    vmIpv6: asString(payload.vm_ipv6),
    period: payload.period
      ? {
          start_timestamp: asString(payload.period.start_timestamp) ?? undefined,
          duration_seconds: asNumber(payload.period.duration_seconds) ?? undefined
        }
      : null
  }
}

export async function notifyCrnAllocation(
  crnUrl: string,
  itemHash: string
): Promise<{ status: 'confirmed' | 'unconfirmed' }> {
  const normalizedCrnUrl = crnUrl.replace(/\/+$/, '')

  try {
    const response = await fetchWithTimeout(`${normalizedCrnUrl}/control/allocation/notify`, {
      method: 'POST',
      headers: {
        // text/plain keeps the request "simple" in browsers, which avoids a
        // preflight even on CRNs that do not implement OPTIONS properly.
        'content-type': 'text/plain;charset=UTF-8'
      },
      body: JSON.stringify({ instance: itemHash }),
      mode: 'cors'
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(`CRN allocation notify failed: ${response.status}${responseText ? ` ${responseText}` : ''}`)
    }

    return { status: 'confirmed' }
  } catch (error) {
    if (isUnconfirmedNetworkError(error)) {
      // The browser can still send the POST before CORS blocks JS from reading
      // the response, so surface this as an unconfirmed request instead of a
      // hard failure.
      return { status: 'unconfirmed' }
    }

    throw error
  }
}

export async function configureOrbitdbRelaySetup(args: {
  hostIpv4: string
  publicIpv6?: string | null
  setupPort: number
  tcpPort: number
  wsPort: number
  metricsPort?: number | null
  metricsHttpsPort?: number | null
  webrtcPort?: number | null
  quicPort?: number | null
}): Promise<{ status: 'configured' | 'unconfirmed' }> {
  const targetUrl = `http://${args.hostIpv4}:${args.setupPort}/configure`

  try {
    const response = await fetchWithTimeout(
      targetUrl,
      {
        method: 'POST',
        headers: {
          'content-type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify({
          public_ipv4: args.hostIpv4,
          public_ipv6: args.publicIpv6 ?? undefined,
          tcp_port: args.tcpPort,
          ws_port: args.wsPort,
          metrics_port: args.metricsPort ?? undefined,
          metrics_https_port: args.metricsHttpsPort ?? undefined,
          webrtc_port: args.webrtcPort ?? undefined,
          quic_port: args.quicPort ?? undefined
        }),
        mode: 'cors'
      },
      30000
    )

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(`Relay setup request failed: ${response.status}${responseText ? ` ${responseText}` : ''}`)
    }

    return { status: 'configured' }
  } catch (error) {
    if (isUnconfirmedNetworkError(error)) {
      return { status: 'unconfirmed' }
    }

    throw error
  }
}

function manualAllocation(instance: InstanceMessage, crns: Crn[]): InstanceAllocation | null {
  const crnHash = instance.content?.requirements?.node?.node_hash
  if (!crnHash) return null

  const matchedCrn = crns.find((crn) => crn.hash === crnHash)
  return {
    source: 'manual',
    crnHash,
    crnUrl: matchedCrn?.address ?? null,
    node: matchedCrn
      ? {
          url: matchedCrn.address
        }
      : null,
    vmIpv6: null,
    period: null
  }
}

async function fetchCrnExecutionMap(crnUrl: string): Promise<CrnExecutionLookupResult> {
  const normalizedCrnUrl = crnUrl.replace(/\/+$/, '')

  // CRN execution lists are only used to enrich the UI. Some CRNs do not expose
  // browser-friendly CORS headers or do not implement either endpoint, so we
  // treat those failures as "runtime details unavailable" rather than errors.
  try {
    const v2Response = await fetchWithTimeout(`${normalizedCrnUrl}/v2/about/executions/list`, { cache: 'no-cache' })
    if (v2Response.ok) {
      return {
        payload: (await v2Response.json()) as CrnExecutionMapPayload,
        blocked: false
      }
    }

    if (v2Response.status !== 404) {
      return { payload: null, blocked: false }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof TypeError || message.includes('Failed to fetch')) {
      return { payload: null, blocked: true }
    }

    return { payload: null, blocked: false }
  }

  try {
    const v1Response = await fetchWithTimeout(`${normalizedCrnUrl}/about/executions/list`, { cache: 'no-cache' })
    if (!v1Response.ok) {
      return { payload: null, blocked: false }
    }

    return {
      payload: (await v1Response.json()) as CrnExecutionMapPayload,
      blocked: false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof TypeError || message.includes('Failed to fetch')) {
      return { payload: null, blocked: true }
    }

    return { payload: null, blocked: false }
  }
}

function normalizeExecution(item: CrnExecutionV1Payload | CrnExecutionV2Payload, crnUrl: string): InstanceExecution {
  const networking = item.networking ?? null
  const mappedPorts =
    networking && 'mapped_ports' in networking && networking.mapped_ports && typeof networking.mapped_ports === 'object'
      ? Object.fromEntries(
          Object.entries(networking.mapped_ports).map(([port, mapping]) => [
            port,
            {
              host: asNumber(mapping?.host) ?? undefined,
              tcp: typeof mapping?.tcp === 'boolean' ? mapping.tcp : undefined,
              udp: typeof mapping?.udp === 'boolean' ? mapping.udp : undefined
            }
          ])
        )
      : undefined

  if (networking && ('host_ipv4' in networking || 'ipv6_ip' in networking || 'ipv4_network' in networking)) {
    const v2Item = item as CrnExecutionV2Payload
    return {
      crnUrl,
      version: 'v2',
      running: typeof v2Item.running === 'boolean' ? v2Item.running : undefined,
      networking: {
        ipv4_network: asString(networking.ipv4_network),
        host_ipv4: asString(networking.host_ipv4),
        ipv6_network: asString(networking.ipv6_network),
        ipv6_ip: asString(networking.ipv6_ip),
        ipv4_ip: asString(networking.ipv4_ip),
        mapped_ports: mappedPorts
      },
      status: v2Item.status
        ? {
            defined_at: asString(v2Item.status.defined_at),
            preparing_at: asString(v2Item.status.preparing_at),
            prepared_at: asString(v2Item.status.prepared_at),
            starting_at: asString(v2Item.status.starting_at),
            started_at: asString(v2Item.status.started_at),
            stopping_at: asString(v2Item.status.stopping_at),
            stopped_at: asString(v2Item.status.stopped_at)
          }
        : null
    }
  }

  return {
    crnUrl,
    version: 'v1',
    networking: {
      ipv4: networking && 'ipv4' in networking ? asString(networking.ipv4) : null,
      ipv6: networking && 'ipv6' in networking ? asString(networking.ipv6) : null
    },
    status: null
  }
}

export async function fetchInstanceRuntimeDetails(
  instances: InstanceMessage[],
  crns: Crn[]
): Promise<Record<string, InstanceRuntimeDetails>> {
  const executionMapCache = new Map<string, Promise<CrnExecutionLookupResult>>()

  async function inspectInstance(instance: InstanceMessage): Promise<InstanceRuntimeDetails> {
    let messageStatus = normalizeMessageStatus(instance.status ?? (instance.confirmed ? 'processed' : undefined))
    if (messageStatus === 'unknown') {
      try {
        const payload = await fetchMessageEnvelope(instance.item_hash)
        const resolvedStatus = normalizeMessageStatus(payload?.status)
        if (resolvedStatus !== 'unknown') {
          messageStatus = resolvedStatus
        }
      } catch {
        // Keep the lightweight list lookup resilient; runtime details can still
        // fall back to "unknown" if the per-message status lookup fails.
      }
    }

    if (messageStatus !== 'processed') {
      return {
        messageStatus,
        allocation: null,
        execution: null
      }
    }

    const details: InstanceRuntimeDetails = {
      messageStatus,
      allocation: null,
      execution: null,
      executionLookupBlocked: false,
      error: null
    }

    try {
      details.allocation = (await fetchSchedulerAllocation(instance.item_hash)) ?? manualAllocation(instance, crns)
    } catch (error) {
      details.error = error instanceof Error ? error.message : String(error)
      return details
    }

    const crnUrl = details.allocation?.crnUrl
    if (!crnUrl) return details

    try {
      let executionPromise = executionMapCache.get(crnUrl)
      if (!executionPromise) {
        executionPromise = fetchCrnExecutionMap(crnUrl)
        executionMapCache.set(crnUrl, executionPromise)
      }

      const executionLookup = await executionPromise
      details.executionLookupBlocked = executionLookup.blocked
      const executionPayload = executionLookup.payload?.[instance.item_hash]
      if (executionPayload) {
        details.execution = normalizeExecution(executionPayload, crnUrl)
        details.executionLookupBlocked = false
      }
    } catch (error) {
      details.error = error instanceof Error ? error.message : String(error)
    }

    return details
  }

  const resolvedDetails = await Promise.all(
    instances.map(async (instance) => [instance.item_hash, await inspectInstance(instance)] as const)
  )

  return Object.fromEntries(resolvedDetails)
}

export async function fetchMessageEnvelope(itemHash: string, apiHost = ALEPH_API_HOST): Promise<MessageEnvelope | null> {
  const response = await fetchWithTimeout(`${apiHost}/api/v0/messages/${itemHash}`, {
    cache: 'no-cache'
  })

  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Message lookup failed: ${response.status}`)

  return (await response.json()) as MessageEnvelope
}

async function fetchReference(itemHash: string, apiHost = ALEPH_API_HOST): Promise<MessageReference> {
  const payload = await fetchMessageEnvelope(itemHash, apiHost)
  if (!payload) {
    return {
      itemHash,
      status: 'missing',
      type: null
    }
  }

  return {
    itemHash,
    status: normalizeMessageStatus(payload.status),
    type: messageTypeFromEnvelope(payload)
  }
}

export async function inspectDeploymentResult(
  itemHash: string,
  rootfsRef?: string,
  apiHost = ALEPH_API_HOST
): Promise<{
  status: MessageStatus
  errorCode: number | null
  details: Record<string, unknown> | null
  rejectionReason: string | null
  references: MessageReference[]
}> {
  const payload = await fetchMessageEnvelope(itemHash, apiHost)
  if (!payload) {
    return {
      status: 'unknown',
      errorCode: null,
      details: null,
      rejectionReason: `Deployment message ${itemHash} was not found on Aleph.`,
      references: []
    }
  }

  const relatedHashes = new Set<string>(rootfsRef ? [rootfsRef] : [])
  for (const referenceHash of extractReferenceHashes(payload.details)) {
    relatedHashes.add(referenceHash)
  }

  const references = await Promise.all(Array.from(relatedHashes).map((hash) => fetchReference(hash, apiHost)))
  const status = normalizeMessageStatus(payload.status)
  const errorCode = typeof payload.error_code === 'number' ? payload.error_code : null
  const details = payload.details && typeof payload.details === 'object' ? (payload.details as Record<string, unknown>) : null

  return {
    status,
    errorCode,
    details,
    rejectionReason: status === 'rejected' ? describeRejectedDeployment(payload, references, rootfsRef) : null,
    references
  }
}

export async function waitForDeploymentResult(
  itemHash: string,
  rootfsRef?: string,
  apiHost = ALEPH_API_HOST,
  attempts = 15,
  delayMs = 2000
): Promise<{
  status: MessageStatus
  errorCode: number | null
  details: Record<string, unknown> | null
  rejectionReason: string | null
  references: MessageReference[]
}> {
  let lastResult = await inspectDeploymentResult(itemHash, rootfsRef, apiHost)

  for (let attempt = 1; attempt < attempts; attempt += 1) {
    if (lastResult.status === 'processed' || lastResult.status === 'rejected') {
      return lastResult
    }

    await new Promise((resolve) => window.setTimeout(resolve, delayMs))
    lastResult = await inspectDeploymentResult(itemHash, rootfsRef, apiHost)
  }

  return lastResult
}

function isInvalidMessageFormatResponse(response: Response, payload: AlephBroadcastResponse): boolean {
  if (response.status !== 422) return false

  const details = payload.details
  if (typeof details === 'string' && details.includes('InvalidMessageFormat')) return true
  if (details && typeof details === 'object') {
    const detailMessage = (details as { message?: unknown }).message
    if (typeof detailMessage === 'string' && detailMessage.includes('InvalidMessageFormat')) return true
  }

  return false
}

async function postBroadcastPayload(
  body: Record<string, unknown>,
  apiHost: string
): Promise<{ response: AlephBroadcastResponse; httpStatus: number; rawResponse: Response }> {
  const rawResponse = await fetchWithTimeout(`${apiHost}/api/v0/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

  const response = (await rawResponse.json().catch(() => ({}))) as AlephBroadcastResponse
  return {
    response,
    httpStatus: rawResponse.status,
    rawResponse
  }
}

export async function broadcastInstanceMessage(
  message: AlephBroadcastMessage,
  apiHost = ALEPH_API_HOST,
  sync = false
): Promise<{ response: AlephBroadcastResponse; httpStatus: number }> {
  const attempts: Array<Record<string, unknown>> = [
    { sync, message },
    { ...message, sync },
    { ...message }
  ]

  for (let index = 0; index < attempts.length; index += 1) {
    const result = await postBroadcastPayload(attempts[index], apiHost)
    if (result.rawResponse.ok || result.httpStatus === 202) {
      return {
        response: result.response,
        httpStatus: result.httpStatus
      }
    }

    const canRetry =
      index < attempts.length - 1 && isInvalidMessageFormatResponse(result.rawResponse, result.response)
    if (!canRetry) {
      throw new Error(`Broadcast failed: ${result.httpStatus} ${JSON.stringify(result.response)}`)
    }
  }

  throw new Error('Broadcast failed: no compatible request format was accepted')
}

export async function broadcastAlephMessage(
  message: AlephBroadcastMessage,
  apiHost = ALEPH_API_HOST,
  sync = false
): Promise<{ response: AlephBroadcastResponse; httpStatus: number }> {
  return broadcastInstanceMessage(message, apiHost, sync)
}
