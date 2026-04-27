import { describe, expect, it } from 'vitest'
import { crnDisplayLabel, crnLocationLabel, crnHost, crnScoreLabel, shortHash } from './format'
import type { Crn } from './types'

describe('format helpers', () => {
  it('extracts the host from a CRN address', () => {
    expect(crnHost('https://ncc3dlb.nodecity.city/')).toBe('ncc3dlb.nodecity.city')
  })

  it('builds a CRN label without location when none is present', () => {
    const crn: Crn = {
      hash: 'a'.repeat(64),
      name: 'NodeCity3',
      address: 'https://ncc3dlb.nodecity.city/'
    }

    expect(crnLocationLabel(crn)).toBeNull()
    expect(crnDisplayLabel(crn)).toBe('NodeCity3 - ncc3dlb.nodecity.city')
  })

  it('appends country information when the CRN payload includes it', () => {
    const crn: Crn = {
      hash: 'a'.repeat(64),
      name: 'NodeCity3',
      address: 'https://ncc3dlb.nodecity.city/',
      country: 'United States'
    }

    expect(crnLocationLabel(crn)).toBe('United States')
    expect(crnDisplayLabel(crn)).toBe('NodeCity3 - ncc3dlb.nodecity.city (United States)')
  })

  it('combines nested city and country location fields', () => {
    const crn: Crn = {
      hash: 'a'.repeat(64),
      name: '',
      address: 'https://skyblue2.zhuxx.site/',
      location: {
        city: 'Dallas',
        country: 'United States'
      }
    }

    expect(crnLocationLabel(crn)).toBe('Dallas, United States')
    expect(crnDisplayLabel(crn)).toBe(
      `${shortHash(crn.hash)} - skyblue2.zhuxx.site (Dallas, United States)`
    )
  })

  it('formats and displays the CRN score when available', () => {
    const crn: Crn = {
      hash: 'b'.repeat(64),
      name: 'NodeCity6',
      address: 'https://ncc6dla.nodecity.city/',
      score: 91.234
    }

    expect(crnScoreLabel(crn)).toBe('91.23')
    expect(crnDisplayLabel(crn)).toBe('91.23 · NodeCity6 - ncc6dla.nodecity.city')
  })
})
