import type { AlephBaseRootfs } from './types'

export const ROOTFS_MANIFEST_URL = './rootfs-manifest.json'
export const IPFS_GATEWAY_BASE_URL = 'https://ipfs.aleph.cloud/ipfs/'
export const DEFAULT_BASE_ROOTFS: AlephBaseRootfs = 'ubuntu22'

export const ALEPH_BASE_ROOTFS_OPTIONS: Array<{
  id: AlephBaseRootfs
  label: string
  summary: string
}> = [
  {
    id: 'ubuntu22',
    label: 'Ubuntu 22',
    summary: 'Aleph-managed default Ubuntu 22 base image.'
  },
  {
    id: 'debian12',
    label: 'Debian 12',
    summary: 'Aleph-managed Debian 12 Bookworm base image.'
  }
]

export const ALEPH_BASE_ROOTFS_ITEM_HASHES: Record<AlephBaseRootfs, string> = {
  ubuntu22: '4a0f62da42f4478544616519e6f5d58adb1096e069b392b151d47c3609492d0c',
  debian12: 'b6ff5c3a8205d1ca4c7c3369300eeafff498b558f71b851aa2114afd0a532717'
}
