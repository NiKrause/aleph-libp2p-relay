import { describe, expect, it } from 'vitest'
import { formatBudgetUnits, paymentChainFromChainId, prepaidVaultConfigured } from './prepaid'

describe('prepaid helpers', () => {
  it('maps known EVM chain ids to Aleph payment chains', () => {
    expect(paymentChainFromChainId('0x1')).toBe('ETH')
    expect(paymentChainFromChainId('0x2105')).toBe('BASE')
    expect(paymentChainFromChainId('0xa86a')).toBe('AVAX')
  })

  it('formats 18-decimal budget units for display', () => {
    expect(formatBudgetUnits(15_500000000000000000n)).toBe(15.5)
  })

  it('treats the prepaid vault as optional configuration', () => {
    expect(typeof prepaidVaultConfigured()).toBe('boolean')
  })
})
