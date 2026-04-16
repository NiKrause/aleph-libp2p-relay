import { describe, expect, it } from 'vitest'
import { validateRootfsManifest } from './rootfsManifest'

describe('validateRootfsManifest', () => {
  it('accepts a complete manifest', () => {
    const result = validateRootfsManifest({
      version: 'relay-v0.1.0',
      rootfsItemHash: 'f'.repeat(64),
      rootfsSizeMiB: 20480,
      createdAt: '2026-04-15'
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects an empty placeholder hash', () => {
    const result = validateRootfsManifest({
      version: 'relay-v0.1.0',
      rootfsItemHash: '',
      rootfsSizeMiB: 20480,
      createdAt: '2026-04-15'
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Rootfs ItemHash must be a 64 character hex value.')
  })
})
