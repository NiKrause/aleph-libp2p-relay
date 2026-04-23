import { describe, expect, it, vi } from 'vitest'
import { createForgetContent, createUnsignedForgetMessage, signForgetMessage } from './alephForget'
import { signaturePayload } from './alephMessage'

describe('Aleph forget helpers', () => {
  it('builds forget content in the Aleph SDK shape', () => {
    const content = createForgetContent({
      address: '0xabc',
      hashes: ['f'.repeat(64)],
      reason: 'Deleted from the PWA',
      now: 10
    })

    expect(content).toEqual({
      address: '0xabc',
      time: 10,
      hashes: ['f'.repeat(64)],
      reason: 'Deleted from the PWA'
    })
  })

  it('creates the exact Aleph signature payload for forget messages', async () => {
    const unsigned = await createUnsignedForgetMessage({
      sender: '0xabc',
      content: createForgetContent({
        address: '0xabc',
        hashes: ['f'.repeat(64)],
        reason: 'Deleted from the PWA',
        now: 10
      }),
      now: 20
    })

    expect(unsigned.type).toBe('FORGET')
    expect(signaturePayload(unsigned)).toBe(`ETH\n0xabc\nFORGET\n${unsigned.item_hash}`)
    expect(JSON.parse(unsigned.item_content)).toEqual({
      address: '0xabc',
      time: 10,
      hashes: ['f'.repeat(64)],
      reason: 'Deleted from the PWA'
    })
  })

  it('uses the same signer flow as instance messages', async () => {
    const signer = vi.fn(async () => '1234')
    const message = await signForgetMessage(
      {
        sender: '0xabc',
        chain: 'ETH',
        type: 'FORGET',
        item_hash: 'f'.repeat(64),
        item_type: 'inline',
        item_content: '{}',
        time: 20,
        channel: 'ALEPH-CLOUDSOLUTIONS'
      },
      signer
    )

    expect(signer).toHaveBeenCalledWith('0xabc', `ETH\n0xabc\nFORGET\n${'f'.repeat(64)}`)
    expect(message.signature).toBe('0x1234')
  })
})
