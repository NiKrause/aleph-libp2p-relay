import type { Crn } from './types'

export function shortHash(value: string, head = 8, tail = 8): string {
  if (!value) return '-'
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}...${value.slice(-tail)}`
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-'
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: value % 1 === 0 ? 0 : Math.min(2, digits)
  }).format(value)
}

export function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  if (value == null || value === '') return Number.NaN
  return Number(value)
}

export function dateLabel(value: string | number | undefined): string {
  if (!value) return '-'
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString()
}

export function explorerUrl(address: string, itemHash: string): string {
  return `https://explorer.aleph.cloud/address/ETH/${address}/message/INSTANCE/${itemHash}`
}

export function apiMessageUrl(itemHash: string): string {
  return `https://api2.aleph.im/api/v0/messages/${itemHash}`
}

export function crnHost(address: string): string {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

function locationParts(crn: Crn): string[] {
  const parts: string[] = []
  const add = (value: unknown) => {
    if (typeof value !== 'string') return
    const normalized = value.trim()
    if (!normalized || parts.includes(normalized)) return
    parts.push(normalized)
  }

  add(crn.city)
  add(crn.region)
  add(crn.country)

  if (typeof crn.location === 'string') {
    add(crn.location)
  } else if (crn.location && typeof crn.location === 'object') {
    add(crn.location.city)
    add(crn.location.region)
    add(crn.location.country)
  }

  return parts
}

export function crnLocationLabel(crn: Crn): string | null {
  const parts = locationParts(crn)
  return parts.length > 0 ? parts.join(', ') : null
}

export function crnDisplayLabel(crn: Crn): string {
  const label = crn.name || shortHash(crn.hash)
  const host = crnHost(crn.address)
  const location = crnLocationLabel(crn)

  return location ? `${label} - ${host} (${location})` : `${label} - ${host}`
}
