import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichCrnsWithGeo } from './crnGeo'
import type { Crn } from './types'

describe('enrichCrnsWithGeo', () => {
  const crn: Crn = {
    hash: 'a'.repeat(64),
    name: 'Test CRN',
    address: 'https://crn.example'
  }

  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('resolves a host IP, stores the location, and reuses the local cache', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            Answer: [{ data: '203.0.113.10', type: 1 }]
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ip: '203.0.113.10',
            city: 'Frankfurt',
            subdivision: 'Hesse',
            country: 'DE'
          }),
          { status: 200 }
        )
      )

    const first = await enrichCrnsWithGeo([crn])
    expect(first[0].resolved_ip).toBe('203.0.113.10')
    expect(first[0].city).toBe('Frankfurt')
    expect(first[0].country).toBe('Germany')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const second = await enrichCrnsWithGeo([crn])
    expect(second[0].resolved_ip).toBe('203.0.113.10')
    expect(second[0].city).toBe('Frankfurt')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
