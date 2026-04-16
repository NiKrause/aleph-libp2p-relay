import { describe, expect, it, vi } from 'vitest'
import { connectWallet, personalSign } from './wallet'

describe('wallet helpers', () => {
  it('connects through an EIP-1193 provider', async () => {
    const provider = {
      isMetaMask: true,
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0xabc']
        if (method === 'eth_chainId') return '0x2105'
        return null
      })
    }

    const wallet = await connectWallet(provider as unknown as EthereumProvider)

    expect(wallet.address).toBe('0xabc')
    expect(wallet.chainId).toBe('0x2105')
    expect(wallet.isMetaMask).toBe(true)
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
})
