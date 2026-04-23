import { ALEPH_API_HOST, IPFS_GATEWAY_BASE_URL, ROOTFS_MANIFEST_URL } from './config'
import { fetchWithTimeout } from './http'
import type { MessageStatus, RootfsManifest, RootfsManifestState, RootfsResolution } from './types'

export const ITEM_HASH_RE = /^[a-fA-F0-9]{64}$/

export function validateRootfsManifest(manifest: RootfsManifest | null): RootfsManifestState {
  const errors: string[] = []

  if (!manifest) {
    return { manifest, valid: false, errors: ['Rootfs manifest is missing.'] }
  }

  if (!manifest.version) errors.push('Rootfs manifest version is missing.')
  if (
    manifest.rootfsInstallStrategy != null &&
    manifest.rootfsInstallStrategy !== 'thin' &&
    manifest.rootfsInstallStrategy !== 'prebaked'
  ) {
    errors.push('Rootfs install strategy must be "thin" or "prebaked" when provided.')
  }
  if (
    manifest.requiresBootstrapNetwork != null &&
    typeof manifest.requiresBootstrapNetwork !== 'boolean'
  ) {
    errors.push('Rootfs bootstrap network flag must be a boolean when provided.')
  }
  if (manifest.bootstrapSummary != null && !manifest.bootstrapSummary.trim()) {
    errors.push('Rootfs bootstrap summary must be non-empty when provided.')
  }
  if (!ITEM_HASH_RE.test(manifest.rootfsItemHash || '')) {
    errors.push('Rootfs ItemHash must be a 64 character hex value.')
  }
  if (!Number.isInteger(manifest.rootfsSizeMiB) || manifest.rootfsSizeMiB <= 0) {
    errors.push('Rootfs size must be a positive MiB integer.')
  }
  if (
    manifest.rootfsSourceSizeBytes != null &&
    (!Number.isInteger(manifest.rootfsSourceSizeBytes) || manifest.rootfsSourceSizeBytes <= 0)
  ) {
    errors.push('Rootfs source size must be a positive byte integer when provided.')
  }
  if (!manifest.createdAt || Number.isNaN(new Date(manifest.createdAt).getTime())) {
    errors.push('Rootfs creation date is missing or invalid.')
  }

  return { manifest, valid: errors.length === 0, errors }
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
  const gateway = cid
    ? await probeGateway(cid, gatewayBaseUrl)
    : { gatewayUrl: null, gatewayStatus: 'unknown' as const, gatewayError: null }

  return {
    itemHash,
    messageStatus: normalizeStatus(payload.status),
    messageType: String(payload.type || messageObject?.type || firstMessage?.type || '').toUpperCase() || null,
    cid,
    receptionTime: typeof payload.reception_time === 'string' ? payload.reception_time : null,
    gatewayUrl: gateway.gatewayUrl,
    gatewayStatus: gateway.gatewayStatus,
    gatewayError: gateway.gatewayError
  }
}
