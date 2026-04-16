import { ALEPH_API_HOST, ROOTFS_MANIFEST_URL } from './config'
import { fetchWithTimeout } from './http'
import type { RootfsManifest, RootfsManifestState } from './types'

export const ITEM_HASH_RE = /^[a-fA-F0-9]{64}$/

export function validateRootfsManifest(manifest: RootfsManifest | null): RootfsManifestState {
  const errors: string[] = []

  if (!manifest) {
    return { manifest, valid: false, errors: ['Rootfs manifest is missing.'] }
  }

  if (!manifest.version) errors.push('Rootfs manifest version is missing.')
  if (!ITEM_HASH_RE.test(manifest.rootfsItemHash || '')) {
    errors.push('Rootfs ItemHash must be a 64 character hex value.')
  }
  if (!Number.isInteger(manifest.rootfsSizeMiB) || manifest.rootfsSizeMiB <= 0) {
    errors.push('Rootfs size must be a positive MiB integer.')
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
  const type = String(payload.type || payload.message?.type || '').toUpperCase()
  return type === 'STORE'
}
