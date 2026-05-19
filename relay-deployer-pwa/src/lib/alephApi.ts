import { ALEPH_API_HOST } from './alephConfig'
import {
  fetch2n6WebAccessUrl,
  fetchCrnExecutionMap,
  fetchMessageEnvelope,
  fetchSchedulerAllocation,
  normalizeExecution,
  normalizeMessageStatus
} from '@le-space/browser'
export {
  broadcastAlephMessage,
  broadcastInstanceMessage,
  configureOrbitdbRelaySetup,
  createAlephBrowserClient,
  fetchBalance,
  fetch2n6WebAccessUrl,
  fetchCrnExecutionMap,
  fetchCrns,
  fetchInstances,
  fetchMessageEnvelope,
  fetchSchedulerAllocation,
  inspectDeploymentResult,
  notifyCrnAllocation,
  normalizeMessageStatus,
  waitForDeploymentResult
} from '@le-space/browser'
import type { Crn, InstanceAllocation, InstanceExecution, InstanceMessage, InstanceRuntimeDetails } from './types'

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeProxyUrl(value: unknown): string | null {
  const stringValue = asString(value)
  if (!stringValue) return null
  if (/^https?:\/\//i.test(stringValue)) return stringValue
  return `https://${stringValue}`
}

function extractProxyCandidates(
  item: {
    web_access?: { url?: unknown; proxy_url?: unknown; hostname?: unknown; domain?: unknown } | null
    webAccess?: { url?: unknown; proxy_url?: unknown; hostname?: unknown; domain?: unknown } | null
  },
  networking:
    | {
        proxy_url?: unknown
        proxyUrl?: unknown
        web_access_url?: unknown
        webAccessUrl?: unknown
        proxy_hostname?: unknown
        proxyHostname?: unknown
        domain?: unknown
        hostname?: unknown
      }
    | null
) {
  return {
    networking: {
      proxy_url: asString(networking?.proxy_url),
      proxyUrl: asString(networking?.proxyUrl),
      web_access_url: asString(networking?.web_access_url),
      webAccessUrl: asString(networking?.webAccessUrl),
      proxy_hostname: asString(networking?.proxy_hostname),
      proxyHostname: asString(networking?.proxyHostname),
      domain: asString(networking?.domain),
      hostname: asString(networking?.hostname)
    },
    web_access: item.web_access
      ? {
          url: asString(item.web_access.url),
          proxy_url: asString(item.web_access.proxy_url),
          hostname: asString(item.web_access.hostname),
          domain: asString(item.web_access.domain)
        }
      : null,
    webAccess: item.webAccess
      ? {
          url: asString(item.webAccess.url),
          proxy_url: asString(item.webAccess.proxy_url),
          hostname: asString(item.webAccess.hostname),
          domain: asString(item.webAccess.domain)
        }
      : null
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

export async function fetchInstanceRuntimeDetails(
  instances: InstanceMessage[],
  crns: Crn[]
): Promise<Record<string, InstanceRuntimeDetails>> {
  const executionMapCache = new Map<string, ReturnType<typeof fetchCrnExecutionMap>>()

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
        execution: null,
        webAccessUrl: null
      }
    }

    const details: InstanceRuntimeDetails = {
      messageStatus,
      allocation: null,
      execution: null,
      webAccessUrl: null,
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
    details.webAccessUrl = await fetch2n6WebAccessUrl(instance.item_hash)
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
      console.info('[instance-runtime] inspected execution payload for web access proxy', {
        instanceItemHash: instance.item_hash,
        crnUrl,
        requestUrl: executionLookup.requestUrl ?? null,
        executionVersion: executionLookup.version ?? null,
        hasExecutionPayload: Boolean(executionPayload)
      })
      if (executionPayload) {
        details.execution = normalizeExecution(executionPayload, crnUrl)
        details.executionLookupBlocked = false
        if (details.execution.version === 'v2') {
          const v2Payload = executionPayload as {
            networking?: Record<string, unknown> | null
            web_access?: { url?: unknown; proxy_url?: unknown; hostname?: unknown; domain?: unknown } | null
            webAccess?: { url?: unknown; proxy_url?: unknown; hostname?: unknown; domain?: unknown } | null
          }
          console.info('[instance-runtime] web access proxy inspection result', {
            instanceItemHash: instance.item_hash,
            requestUrl: executionLookup.requestUrl ?? null,
            proxyUrl: details.execution.networking.proxy_url ?? null,
            rawCandidates: extractProxyCandidates(v2Payload, v2Payload.networking ?? null)
          })
        }
        if (!details.execution.networking.proxy_url && details.webAccessUrl) {
          details.execution.networking.proxy_url = details.webAccessUrl
        }
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
