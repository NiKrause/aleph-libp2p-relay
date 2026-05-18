import {
  ITEM_HASH_RE as SHARED_ITEM_HASH_RE,
  validateRootfsManifest as sharedValidateRootfsManifest
} from '@le-space/rootfs'
import { ALEPH_API_HOST, IPFS_GATEWAY_BASE_URL, ROOTFS_MANIFEST_URL } from './config'
import { fetchWithTimeout } from './http'
import type { MessageStatus, RootfsManifest, RootfsManifestState, RootfsResolution } from './types'

export const ITEM_HASH_RE = SHARED_ITEM_HASH_RE

export function validateRootfsManifest(manifest: RootfsManifest | null): RootfsManifestState {
  const result = sharedValidateRootfsManifest(manifest as Parameters<typeof sharedValidateRootfsManifest>[0])
  return {
    manifest: result.manifest as RootfsManifest | null,
    valid: result.valid,
    errors: result.errors
  }
}

export async function loadRootfsManifest(url = ROOTFS_MANIFEST_URL): Promise<RootfsManifestState> {
  const response = await fetchWithTimeout(url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`Rootfs manifest request failed: ${response.status}`)
  }

  return validateRootfsManifest((await response.json()) as RootfsManifest)
}

export async function verifyRootfsExists(itemHash: string, apiHost = ALEPH_API_HOST): Promise<boolean> {
  if (!ITEM_HASH_RE.test(itemHash)) return false

  const response = await fetchWithTimeout(`${apiHost}/api/v0/messages/${itemHash}`, {
    method: 'GET',
    cache: 'no-cache'
  })

  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Rootfs lookup failed: ${response.status}`)

  const payload = await response.json()
  const firstMessage = Array.isArray(payload.messages) ? payload.messages[0] : undefined
  const type = String(payload.type || payload.message?.type || firstMessage?.type || '').toUpperCase()
  return type === 'STORE'
}

function normalizeStatus(status: unknown): MessageStatus {
  if (typeof status !== 'string') return 'unknown'
  const normalized = status.toLowerCase()
  if (normalized === 'processed' || normalized === 'pending' || normalized === 'rejected') {
    return normalized
  }
  return 'unknown'
}

function parseCidFromPayload(payload: Record<string, unknown>): string | null {
  const firstMessage =
    Array.isArray(payload.messages) && payload.messages[0] && typeof payload.messages[0] === 'object'
      ? (payload.messages[0] as Record<string, unknown>)
      : null

  const directContent =
    firstMessage?.content && typeof firstMessage.content === 'object'
      ? (firstMessage.content as Record<string, unknown>)
      : null

  if (typeof directContent?.item_hash === 'string') {
    return directContent.item_hash
  }

  if (typeof firstMessage?.item_content === 'string') {
    try {
      const itemContent = JSON.parse(firstMessage.item_content) as Record<string, unknown>
      if (typeof itemContent.item_hash === 'string') {
        return itemContent.item_hash
      }
    } catch {
      return null
    }
  }

  return null
}

function parseRejectionReason(payload: Record<string, unknown>): Pick<RootfsResolution, 'rejectionErrorCode' | 'rejectionReason'> {
  const errorCode = typeof payload.error_code === 'number' ? payload.error_code : null
  const details = payload.details && typeof payload.details === 'object' ? (payload.details as Record<string, unknown>) : null
  const rawErrors = Array.isArray(details?.errors) ? details.errors : []
  const firstError =
    rawErrors[0] && typeof rawErrors[0] === 'object' ? (rawErrors[0] as Record<string, unknown>) : null

  if (firstError) {
    const accountBalance = Number(firstError.account_balance)
    const requiredBalance = Number(firstError.required_balance)
    if (Number.isFinite(accountBalance) && Number.isFinite(requiredBalance)) {
      const shortfall = requiredBalance - accountBalance
      return {
        rejectionErrorCode: errorCode,
        rejectionReason:
          shortfall > 0
            ? `Rejected by Aleph for insufficient hold balance: ${accountBalance.toFixed(3)} available, ${requiredBalance.toFixed(3)} required, ${shortfall.toFixed(3)} short.`
            : `Rejected by Aleph for insufficient hold balance: ${accountBalance.toFixed(3)} available, ${requiredBalance.toFixed(3)} required.`
      }
    }
  }

  return {
    rejectionErrorCode: errorCode,
    rejectionReason: errorCode != null ? `Rejected by Aleph (error code ${errorCode}).` : null
  }
}

async function probeGateway(cid: string, gatewayBaseUrl = IPFS_GATEWAY_BASE_URL): Promise<Pick<RootfsResolution, 'gatewayStatus' | 'gatewayError' | 'gatewayUrl'>> {
  const gatewayUrl = new URL(cid, gatewayBaseUrl).toString()

  try {
    const response = await fetchWithTimeout(gatewayUrl, { method: 'HEAD', cache: 'no-store' }, 5000)
    return {
      gatewayUrl,
      gatewayStatus: response.ok ? 'reachable' : 'error',
      gatewayError: response.ok ? null : `Gateway responded with ${response.status}.`
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      return {
        gatewayUrl,
        gatewayStatus: 'timeout',
        gatewayError: error.message
      }
    }

    return {
      gatewayUrl,
      gatewayStatus: 'unavailable',
      gatewayError: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function resolveRootfsReference(
  itemHash: string,
  apiHost = ALEPH_API_HOST,
  gatewayBaseUrl = IPFS_GATEWAY_BASE_URL
): Promise<RootfsResolution | null> {
  if (!ITEM_HASH_RE.test(itemHash)) return null

  const response = await fetchWithTimeout(`${apiHost}/api/v0/messages/${itemHash}`, {
    method: 'GET',
    cache: 'no-cache'
  })

  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Rootfs lookup failed: ${response.status}`)

  const payload = (await response.json()) as Record<string, unknown>
  const firstMessage =
    Array.isArray(payload.messages) && payload.messages[0] && typeof payload.messages[0] === 'object'
      ? (payload.messages[0] as Record<string, unknown>)
      : null
  const messageObject =
    payload.message && typeof payload.message === 'object' ? (payload.message as Record<string, unknown>) : null

  const cid = parseCidFromPayload(payload)
  const rejection = normalizeStatus(payload.status) === 'rejected'
    ? parseRejectionReason(payload)
    : { rejectionErrorCode: null, rejectionReason: null }
  const gateway = cid
    ? await probeGateway(cid, gatewayBaseUrl)
    : { gatewayUrl: null, gatewayStatus: 'unknown' as const, gatewayError: null }

  return {
    itemHash,
    messageStatus: normalizeStatus(payload.status),
    messageType: String(payload.type || messageObject?.type || firstMessage?.type || '').toUpperCase() || null,
    cid,
    receptionTime: typeof payload.reception_time === 'string' ? payload.reception_time : null,
    rejectionErrorCode: rejection.rejectionErrorCode,
    rejectionReason: rejection.rejectionReason,
    gatewayUrl: gateway.gatewayUrl,
    gatewayStatus: gateway.gatewayStatus,
    gatewayError: gateway.gatewayError
  }
}
