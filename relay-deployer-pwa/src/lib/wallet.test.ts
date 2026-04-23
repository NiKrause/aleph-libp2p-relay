import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectWallet, fetchAlephTokenBalance, personalSign, toChecksumAddress } from './wallet'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('wallet helpers', () => {
  it('connects through an EIP-1193 provider', async () => {
    const provider = {
      isMetaMask: true,
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0x822a6cc04c19ec6fa1167896658a87a449f4dd15']
        if (method === 'eth_chainId') return '0x2105'
        return null
      })
    }

    const wallet = await connectWallet(provider as unknown as EthereumProvider)

    expect(wallet.address).toBe('0x822A6cc04c19eC6FA1167896658A87a449F4dd15')
    expect(wallet.chainId).toBe('0x2105')
    expect(wallet.isMetaMask).toBe(true)
  })

  it('converts lowercase addresses to EIP-55 checksum format', () => {
    expect(toChecksumAddress('0x822a6cc04c19ec6fa1167896658a87a449f4dd15')).toBe(
      '0x822A6cc04c19eC6FA1167896658A87a449F4dd15'
    )
  })

  it('personal_sign encodes the verification buffer as hex', async () => {
    const provider = {
      request: vi.fn(async () => '0xsig')
    }

    const signature = await personalSign('0xabc', 'ETH\n0xabc\nINSTANCE\nhash', provider as unknown as EthereumProvider)

    expect(signature).toBe('0xsig')
    expect(provider.request).toHaveBeenCalledWith({
      method: 'personal_sign',
      params: ['0x4554480a30786162630a494e5354414e43450a68617368', '0xabc']
    })
  })

  it('fetches the ALEPH token balance for a selected chain via JSON-RPC', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: '0x6c6b935b8bbd400000'
        }),
        { status: 200 }
      )
    )

    const balance = await fetchAlephTokenBalance('0x822A6cc04c19eC6FA1167896658A87a449F4dd15', 'ETH')

    expect(balance).toBe(2000)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('POST')
    expect(String(init?.body)).toContain('"method":"eth_call"')
    expect(String(init?.body)).toContain('70a08231')
  })
})
