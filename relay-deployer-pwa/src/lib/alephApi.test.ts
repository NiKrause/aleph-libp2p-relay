import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  broadcastInstanceMessage,
  configureOrbitdbRelaySetup,
  fetchBalance,
  fetchInstanceRuntimeDetails,
  fetchInstances,
  inspectDeploymentResult,
  notifyCrnAllocation
} from './alephApi'

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

  it('marks confirmed instances as processed when the list payload omits status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [{ item_hash: 'h'.repeat(64), type: 'INSTANCE', confirmed: true, status: null }]
        }),
        { status: 200 }
      )
    )

    await expect(fetchInstances('0xabc')).resolves.toEqual([
      expect.objectContaining({
        item_hash: 'h'.repeat(64),
        status: 'processed',
        confirmed: true
      })
    ])
  })

  it('resolves unknown instance status from the per-message API before loading runtime details', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'processed'
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            node: {
              url: 'https://selected-crn.example'
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ['a'.repeat(64)]: {
              networking: {
                host_ipv4: '149.86.227.106',
                ipv4_ip: '172.16.7.2',
                mapped_ports: {
                  '22': {
                    host: 24008,
                    tcp: true,
                    udp: false
                  }
                }
              },
              status: {
                started_at: '2026-04-24T15:56:47Z'
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
          status: undefined,
          confirmed: false,
          content: {
            payment: { type: 'hold' }
          }
        }
      ],
      []
    )

    expect(details['a'.repeat(64)]).toMatchObject({
      messageStatus: 'processed',
      allocation: {
        crnUrl: 'https://selected-crn.example'
      },
      execution: {
        networking: {
          host_ipv4: '149.86.227.106',
          mapped_ports: {
            '22': {
              host: 24008
            }
          }
        }
      }
    })
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
      executionLookupBlocked: false,
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
      new Response('', { status: 404 })
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

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://scheduler.api.aleph.cloud/api/v0/allocation/')
    expect(String(fetchMock.mock.calls[1][0])).toContain('https://selected-crn.example/v2/about/executions/list')
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

  it('treats browser-blocked CRN execution lookups as optional runtime details', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const details = await fetchInstanceRuntimeDetails(
      [
        {
          item_hash: 'd'.repeat(64),
          sender: '0xabc',
          chain: 'ETH',
          type: 'INSTANCE',
          status: 'processed',
          content: {
            payment: { type: 'credit', chain: 'ETH' },
            requirements: {
              node: {
                node_hash: 'e'.repeat(64)
              }
            }
          }
        }
      ],
      [
        {
          hash: 'e'.repeat(64),
          name: 'Selected CRN',
          address: 'https://selected-crn.example'
        }
      ]
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('https://scheduler.api.aleph.cloud/api/v0/allocation/')
    expect(String(fetchMock.mock.calls[1][0])).toContain('https://selected-crn.example/v2/about/executions/list')
    expect(details['d'.repeat(64)]).toMatchObject({
      messageStatus: 'processed',
      allocation: {
        source: 'manual',
        crnHash: 'e'.repeat(64),
        crnUrl: 'https://selected-crn.example'
      },
      executionLookupBlocked: true,
      execution: null,
      error: null
    })
  })

  it('prefers scheduler allocation details over the selected CRN hint when both exist', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            vm_hash: 'f'.repeat(64),
            vm_ipv6: '2001:db8::42',
            node: {
              node_id: 'scheduler-crn',
              url: 'https://scheduled-crn.example'
            }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 404 }))

    const details = await fetchInstanceRuntimeDetails(
      [
        {
          item_hash: 'f'.repeat(64),
          sender: '0xabc',
          chain: 'ETH',
          type: 'INSTANCE',
          status: 'processed',
          content: {
            payment: { type: 'credit', chain: 'ETH' },
            requirements: {
              node: {
                node_hash: 'g'.repeat(64)
              }
            }
          }
        }
      ],
      [
        {
          hash: 'g'.repeat(64),
          name: 'Selected CRN',
          address: 'https://selected-crn.example'
        }
      ]
    )

    expect(details['f'.repeat(64)]?.allocation).toMatchObject({
      source: 'scheduler',
      crnUrl: 'https://scheduled-crn.example'
    })
  })

  it('treats browser-blocked allocation notify requests as unconfirmed rather than failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(notifyCrnAllocation('https://selected-crn.example/', 'a'.repeat(64))).resolves.toEqual({
      status: 'unconfirmed'
    })
  })

  it('treats timed out allocation notify requests as unconfirmed rather than failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException('The operation was aborted.', 'AbortError')), 0)
        })
    )

    await expect(notifyCrnAllocation('https://selected-crn.example/', 'a'.repeat(64))).resolves.toEqual({
      status: 'unconfirmed'
    })
  })

  it('sends allocation notify requests to the CRN control endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}', { status: 200 }))

    await expect(notifyCrnAllocation('https://selected-crn.example/', 'a'.repeat(64))).resolves.toEqual({
      status: 'confirmed'
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('https://selected-crn.example/control/allocation/notify')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST'
    })
  })

  it('posts mapped ports to the temporary orbitdb relay setup endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'configured' }), { status: 200 })
    )

    await expect(
      configureOrbitdbRelaySetup({
        hostIpv4: '62.141.40.252',
        publicIpv6: '2a01:4f8:c010:4b5::42',
        setupPort: 28080,
        tcpPort: 28191,
        wsPort: 28192,
        metricsPort: 28190,
        metricsHttpsPort: 29443,
        webrtcPort: 28193,
        quicPort: 28194
      })
    ).resolves.toEqual({ status: 'configured' })

    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /^http:\/\/62\.141\.40\.252:28080\/configure\?_ts=\d+$/
    )
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      mode: 'cors'
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      public_ipv4: '62.141.40.252',
      public_ipv6: '2a01:4f8:c010:4b5::42',
      tcp_port: 28191,
      ws_port: 28192,
      metrics_port: 28190,
      metrics_https_port: 29443,
      webrtc_port: 28193,
      quic_port: 28194
    })
  })

  it('treats timed out relay setup requests as unconfirmed so the UI can retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException('The operation was aborted.', 'AbortError')), 0)
        })
    )

    await expect(
      configureOrbitdbRelaySetup({
        hostIpv4: '62.141.40.252',
        setupPort: 28080,
        tcpPort: 28191,
        wsPort: 28192
      })
    ).resolves.toEqual({ status: 'unconfirmed' })
  })
})
