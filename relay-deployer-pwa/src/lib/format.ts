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
