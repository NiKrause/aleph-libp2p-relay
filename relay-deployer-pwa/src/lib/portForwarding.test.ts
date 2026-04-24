import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureInstancePortForwards, mergeRequiredPortForwards } from './portForwarding'
import type { RootfsManifest } from './types'

afterEach(() => {
  vi.restoreAllMocks()
})

const manifest: RootfsManifest = {
  profile: 'orbitdb-relay-pinner',
  version: 'orbitdb-relay-pinner-v0.1.0',
  requiredPortForwards: [
    { port: 9090, tcp: true, udp: false, purpose: 'Metrics and health API' },
    { port: 9091, tcp: true, udp: false, purpose: 'libp2p TCP' },
    { port: 9093, tcp: false, udp: true, purpose: 'WebRTC direct' }
  ],
  rootfsItemHash: 'f'.repeat(64),
  rootfsSizeMiB: 20480,
  createdAt: '2026-04-24T00:00:00Z'
}

describe('port forwarding helpers', () => {
  it('merges and de-duplicates requested ports', () => {
    expect(
      mergeRequiredPortForwards(
        [{ port: 22, tcp: true, udp: false, purpose: 'SSH' }],
        [
          { port: 9091, tcp: true, udp: false, purpose: 'TCP relay' },
          { port: 9091, tcp: false, udp: true },
          { port: 9093, tcp: false, udp: true }
        ]
      )
    ).toEqual([
      { port: 22, tcp: true, udp: false, purpose: 'SSH' },
      { port: 9091, tcp: true, udp: true, purpose: 'TCP relay' },
      { port: 9093, tcp: false, udp: true, purpose: undefined }
    ])
  })

  it('publishes a port-forward aggregate that includes default SSH and manifest ports', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              'port-forwarding': {
                ['a'.repeat(64)]: {
                  ports: {
                    '22': { tcp: true, udp: false }
                  }
                }
              }
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ publication_status: { status: 'success' } }), { status: 200 }))

    const result = await ensureInstancePortForwards({
      sender: '0xabc',
      instanceItemHash: 'a'.repeat(64),
      manifest,
      signer: vi.fn(async () => '0x1234')
    })

    expect(result.aggregateStatus).toBe('processed')
    expect(result.requestedPorts).toEqual([
      { port: 22, tcp: true, udp: false, purpose: 'SSH' },
      { port: 9090, tcp: true, udp: false, purpose: 'Metrics and health API' },
      { port: 9091, tcp: true, udp: false, purpose: 'libp2p TCP' },
      { port: 9093, tcp: false, udp: true, purpose: 'WebRTC direct' }
    ])

    const [, init] = fetchMock.mock.calls[1]
    const payload = JSON.parse(String(init?.body)) as { message: { type: string; item_content: string } }
    const aggregateContent = JSON.parse(payload.message.item_content) as {
      key: string
      content: Record<string, { ports: Record<string, { tcp: boolean; udp: boolean }> }>
    }

    expect(payload.message.type).toBe('AGGREGATE')
    expect(aggregateContent.key).toBe('port-forwarding')
    expect(aggregateContent.content['a'.repeat(64)]).toEqual({
      ports: {
        '22': { tcp: true, udp: false },
        '9090': { tcp: true, udp: false },
        '9091': { tcp: true, udp: false },
        '9093': { tcp: false, udp: true }
      }
    })
  })
})
