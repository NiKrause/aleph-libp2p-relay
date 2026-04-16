import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateRootfsManifest, verifyRootfsExists } from './rootfsManifest'

afterEach(() => {
  vi.restoreAllMocks()
})

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

  it('verifies a store message returned in the Aleph messages array shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'pending',
          messages: [{ type: 'STORE' }]
        }),
        { status: 200 }
      )
    )

    await expect(verifyRootfsExists('f'.repeat(64))).resolves.toBe(true)
  })
})
