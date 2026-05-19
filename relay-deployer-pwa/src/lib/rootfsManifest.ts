import {
  ITEM_HASH_RE as SHARED_ITEM_HASH_RE,
  loadRootfsManifest as sharedLoadRootfsManifest,
  resolveRootfsReference as sharedResolveRootfsReference,
  validateRootfsManifest as sharedValidateRootfsManifest,
  verifyRootfsExists as sharedVerifyRootfsExists
} from '@le-space/browser'
import { ALEPH_API_HOST } from './alephConfig'
import { IPFS_GATEWAY_BASE_URL, ROOTFS_MANIFEST_URL } from './rootfsConfig'
import type { RootfsManifest, RootfsManifestState, RootfsResolution } from './types'

export const ITEM_HASH_RE = SHARED_ITEM_HASH_RE

export function validateRootfsManifest(manifest: RootfsManifest | null): RootfsManifestState {
  const result = sharedValidateRootfsManifest(manifest)
  return {
    manifest: result.manifest as RootfsManifest | null,
    valid: result.valid,
    errors: result.errors
  }
}

export async function loadRootfsManifest(url = ROOTFS_MANIFEST_URL): Promise<RootfsManifestState> {
  return (await sharedLoadRootfsManifest(url)) as RootfsManifestState
}

export async function verifyRootfsExists(itemHash: string, apiHost = ALEPH_API_HOST): Promise<boolean> {
  return sharedVerifyRootfsExists(itemHash, apiHost)
}

export async function resolveRootfsReference(
  itemHash: string,
  apiHost = ALEPH_API_HOST,
  gatewayBaseUrl = IPFS_GATEWAY_BASE_URL
): Promise<RootfsResolution | null> {
  return (await sharedResolveRootfsReference(itemHash, apiHost, gatewayBaseUrl)) as RootfsResolution | null
}
