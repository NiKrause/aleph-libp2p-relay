import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveRootfsReference, validateRootfsManifest, verifyRootfsExists } from './rootfsManifest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validateRootfsManifest', () => {
  it('accepts a complete manifest', () => {
    const result = validateRootfsManifest({
      profile: 'orbitdb-relay-pinner',
      version: 'relay-v0.1.0',
      rootfsInstallStrategy: 'thin',
      requiresBootstrapNetwork: true,
      bootstrapSummary: 'First boot installs runtime packages and dependencies.',
      requiredPortForwards: [
        { port: 22, tcp: true, udp: false, purpose: 'SSH' },
        { port: 9091, tcp: true, udp: false, purpose: 'libp2p TCP' }
      ],
      rootfsItemHash: 'f'.repeat(64),
      rootfsSizeMiB: 20480,
      rootfsSourceSizeBytes: 2445860819,
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

  it('rejects an invalid install strategy when provided', () => {
    const result = validateRootfsManifest({
      version: 'relay-v0.1.0',
      rootfsInstallStrategy: 'dynamic' as never,
      rootfsItemHash: 'f'.repeat(64),
      rootfsSizeMiB: 20480,
      createdAt: '2026-04-15'
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Rootfs install strategy must be "thin" or "prebaked" when provided.')
  })

  it('rejects an invalid optional source-size field', () => {
    const result = validateRootfsManifest({
      version: 'relay-v0.1.0',
      rootfsItemHash: 'f'.repeat(64),
      rootfsSizeMiB: 20480,
      rootfsSourceSizeBytes: 0,
      createdAt: '2026-04-15'
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Rootfs source size must be a positive byte integer when provided.')
  })

  it('rejects invalid required port-forward declarations', () => {
    const result = validateRootfsManifest({
      version: 'relay-v0.1.0',
      requiredPortForwards: [
        { port: 0, tcp: false, udp: false, purpose: ' ' },
        { port: 9091, tcp: false, udp: false }
      ],
      rootfsItemHash: 'f'.repeat(64),
      rootfsSizeMiB: 20480,
      createdAt: '2026-04-15'
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Rootfs required port forward #1 must use a TCP/UDP port between 1 and 65535.')
    expect(result.errors).toContain('Rootfs required port forward #1 must enable TCP or UDP.')
    expect(result.errors).toContain('Rootfs required port forward #1 purpose must be non-empty when provided.')
    expect(result.errors).toContain('Rootfs required port forward #2 must enable TCP or UDP.')
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

  it('resolves the rootfs cid and Aleph status from the store message', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'pending',
            reception_time: '2026-04-16T13:28:47.044481Z',
            messages: [
              {
                type: 'STORE',
                content: {
                  item_hash: 'QmExampleCid'
                }
              }
            ]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response('', { status: 200 }))

    const result = await resolveRootfsReference('f'.repeat(64))

    expect(result).toEqual({
      itemHash: 'f'.repeat(64),
      messageStatus: 'pending',
      messageType: 'STORE',
      cid: 'QmExampleCid',
      receptionTime: '2026-04-16T13:28:47.044481Z',
      rejectionErrorCode: null,
      rejectionReason: null,
      gatewayUrl: 'https://ipfs.aleph.cloud/ipfs/QmExampleCid',
      gatewayStatus: 'reachable',
      gatewayError: null
    })
  })

  it('surfaces Aleph rejection details for rejected store messages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'rejected',
          error_code: 5,
          details: {
            errors: [
              {
                account_balance: '2084.447358385644',
                required_balance: '2257.863908099293478965'
              }
            ]
          },
          messages: [
            {
              type: 'STORE',
              content: {
                item_hash: 'QmExampleCid'
              }
            }
          ]
        }),
        { status: 200 }
      )
    )
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }))

    const result = await resolveRootfsReference('f'.repeat(64))

    expect(result?.rejectionErrorCode).toBe(5)
    expect(result?.rejectionReason).toContain('Rejected by Aleph for insufficient hold balance')
    expect(result?.rejectionReason).toContain('2084.447 available')
    expect(result?.rejectionReason).toContain('2257.864 required')
  })
})
