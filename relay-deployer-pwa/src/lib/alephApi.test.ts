import { afterEach, describe, expect, it, vi } from 'vitest'
import { broadcastInstanceMessage, fetchBalance, fetchInstanceRuntimeDetails, fetchInstances, inspectDeploymentResult } from './alephApi'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Aleph API client', () => {
  it('fetches balances from the public API path', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          address: '0xabc',
          balance: '1',
          locked_amount: '0',
          credit_balance: 2
        }),
        { status: 200 }
      )
    )

    const balance = await fetchBalance('0xabc')

    expect(balance.credit_balance).toBe(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v0/addresses/0xabc/balance')
  })

  it('lists instance messages for an address', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ item_hash: 'a'.repeat(64), type: 'INSTANCE' }] }), {
        status: 200
      })
    )

    const instances = await fetchInstances('0xabc')
    const url = new URL(String(fetchMock.mock.calls[0][0]))

    expect(instances).toHaveLength(1)
    expect(url.searchParams.get('msgTypes')).toBe('INSTANCE')
    expect(url.searchParams.get('addresses')).toBe('0xabc')
    expect(url.searchParams.get('message_statuses')).toBe('processed,pending,rejected,removing')
  })

  it('explains a rejected deployment with a pending rootfs reference', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'rejected',
            error_code: 301,
            details: {
              errors: ['b'.repeat(64)]
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'pending',
            messages: [{ type: 'STORE' }]
          }),
          { status: 200 }
        )
      )

    const result = await inspectDeploymentResult('a'.repeat(64), 'b'.repeat(64))

    expect(result.status).toBe('rejected')
    expect(result.errorCode).toBe(301)
    expect(result.references).toEqual([
      {
        itemHash: 'b'.repeat(64),
        status: 'pending',
        type: 'STORE'
      }
    ])
    expect(result.rejectionReason).toContain('referenced rootfs STORE message')
  })

  it('broadcasts signed messages', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ publication_status: { status: 'success' } }), { status: 200 })
    )

    await broadcastInstanceMessage({
      sender: '0xabc',
      chain: 'ETH',
      signature: '0x1234',
      type: 'INSTANCE',
      item_hash: 'a'.repeat(64),
      item_type: 'inline',
      item_content: '{}',
      time: 1,
      channel: 'ALEPH-CLOUDSOLUTIONS'
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/v0/messages')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body)).message.signature).toBe('0x1234')
  })

  it('retries with a flattened request body after InvalidMessageFormat', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ details: 'InvalidMessageFormat' }), {
          status: 422
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ publication_status: { status: 'success' } }), { status: 200 }))

    await broadcastInstanceMessage({
      sender: '0xabc',
      chain: 'ETH',
      signature: '0x1234',
      type: 'INSTANCE',
      item_hash: 'a'.repeat(64),
      item_type: 'inline',
      item_content: '{}',
      time: 1,
      channel: 'ALEPH-CLOUDSOLUTIONS'
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      sync: false,
      message: {
        sender: '0xabc',
        chain: 'ETH',
        signature: '0x1234',
        type: 'INSTANCE',
        item_hash: 'a'.repeat(64),
        item_type: 'inline',
        item_content: '{}',
        time: 1,
        channel: 'ALEPH-CLOUDSOLUTIONS'
      }
    })
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      sender: '0xabc',
      chain: 'ETH',
      signature: '0x1234',
      type: 'INSTANCE',
      item_hash: 'a'.repeat(64),
      item_type: 'inline',
      item_content: '{}',
      time: 1,
      channel: 'ALEPH-CLOUDSOLUTIONS',
      sync: false
    })
  })

  it('loads scheduler allocation and runtime networking for a processed hold instance', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            vm_hash: 'a'.repeat(64),
            vm_ipv6: '2a02:c207:1:2178::2',
            period: {
              start_timestamp: '2026-04-21T10:00:00Z',
              duration_seconds: 30
            },
            node: {
              node_id: 'crn-dc-12',
              url: 'https://dv1ca.deepvalley.cloud',
              ipv6: '2604:4300::1',
              supports_ipv6: true
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            [Array(65).join('a')]: {
              networking: {
                ipv4_network: '172.16.7.0/24',
                host_ipv4: '167.86.74.178',
                ipv6_network: '2a02:c207:1:2178::/124',
                ipv6_ip: '2a02:c207:1:2178::3',
                ipv4_ip: '172.16.7.2',
                mapped_ports: {
                  '22': {
                    host: 24018,
                    tcp: true,
                    udp: false
                  }
                }
              },
              status: {
                started_at: '2026-04-21T10:01:00Z'
              },
              running: true
            }
          }),
          { status: 200 }
        )
      )

    const details = await fetchInstanceRuntimeDetails(
      [
        {
          item_hash: 'a'.repeat(64),
          sender: '0xabc',
          chain: 'ETH',
          type: 'INSTANCE',
          status: 'processed',
          content: {
            payment: { type: 'hold', chain: 'ETH' }
          }
        }
      ],
      []
    )

    expect(details['a'.repeat(64)]).toMatchObject({
      messageStatus: 'processed',
      allocation: {
        source: 'scheduler',
        crnUrl: 'https://dv1ca.deepvalley.cloud',
        vmIpv6: '2a02:c207:1:2178::2'
      },
      execution: {
        crnUrl: 'https://dv1ca.deepvalley.cloud',
        version: 'v2',
        running: true,
        networking: {
          host_ipv4: '167.86.74.178',
          ipv6_ip: '2a02:c207:1:2178::3'
        }
      }
    })
  })

  it('loads manual CRN runtime details for a credit instance without hitting the scheduler', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          [Array(65).join('b')]: {
            networking: {
              ipv4: '203.0.113.10',
              ipv6: '2001:db8::10'
            }
          }
        }),
        { status: 404 }
      )
    )

    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          [Array(65).join('b')]: {
            networking: {
              ipv4: '203.0.113.10',
              ipv6: '2001:db8::10'
            }
          }
        }),
        { status: 200 }
      )
    )

    const details = await fetchInstanceRuntimeDetails(
      [
        {
          item_hash: 'b'.repeat(64),
          sender: '0xabc',
          chain: 'ETH',
          type: 'INSTANCE',
          status: 'processed',
          content: {
            payment: { type: 'credit', chain: 'ETH' },
            requirements: {
              node: {
                node_hash: 'c'.repeat(64)
              }
            }
          }
        }
      ],
      [
        {
          hash: 'c'.repeat(64),
          name: 'Selected CRN',
          address: 'https://selected-crn.example'
        }
      ]
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://selected-crn.example/v2/about/executions/list')
    expect(details['b'.repeat(64)]).toMatchObject({
      messageStatus: 'processed',
      allocation: {
        source: 'manual',
        crnHash: 'c'.repeat(64),
        crnUrl: 'https://selected-crn.example'
      },
      execution: {
        version: 'v1',
        networking: {
          ipv4: '203.0.113.10',
          ipv6: '2001:db8::10'
        }
      }
    })
  })
})
