import { afterEach, describe, expect, it, vi } from 'vitest'
import { broadcastInstanceMessage, fetchBalance, fetchInstances } from './alephApi'

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
    expect(url.searchParams.get('message_statuses')).toBe('processed,removing')
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
})
