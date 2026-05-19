import { enrichCrnsWithGeo as enrichCrnsWithGeoShared } from '@le-space/core'
import { crnHost, crnLocationLabel } from './format'
import { fetchWithTimeout } from './http'
import type { Crn } from './types'

const CRN_GEO_CACHE_KEY = 'aleph-relay-deployer:crn-geo-cache:v1'
const CRN_GEO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CRN_GEO_NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000
const DNS_RESOLVE_TIMEOUT_MS = 10000
const GEO_LOOKUP_TIMEOUT_MS = 10000
const COUNTRY_IS_API_BASE_URL = 'https://api.country.is'
const GEO_LOOKUP_RATE_LIMIT = 10
const GEO_LOOKUP_WINDOW_MS = 1000

let geoLookupQueue: Promise<void> = Promise.resolve()
const geoLookupStartTimes: number[] = []

interface CrnGeoCacheEntry {
  fetchedAt: number
  ip: string | null
  city: string | null
  region: string | null
  country: string | null
  country_code: string | null
}

function logGeo(level: 'debug' | 'warn', message: string, extra?: unknown) {
  if (typeof console === 'undefined') return
  const prefix = '[crn-geo]'
  if (level === 'warn') {
    console.warn(prefix, message, extra ?? '')
    return
  }
  console.debug(prefix, message, extra ?? '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function countryNameFromCode(value: string | null): string | null {
  if (!value || typeof Intl === 'undefined' || typeof Intl.DisplayNames === 'undefined') return value

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'region' })
    return displayNames.of(value.toUpperCase()) ?? value
  } catch {
    return value
  }
}

function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function loadCache(): Record<string, CrnGeoCacheEntry> {
  if (!storageAvailable()) return {}

  try {
    const raw = window.localStorage.getItem(CRN_GEO_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, CrnGeoCacheEntry>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveCache(cache: Record<string, CrnGeoCacheEntry>) {
  if (!storageAvailable()) return

  try {
    window.localStorage.setItem(CRN_GEO_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Ignore storage quota/privacy failures and keep the UI usable.
  }
}

function hasResolvedGeo(entry: CrnGeoCacheEntry | undefined): boolean {
  return Boolean(entry && (entry.country || entry.region || entry.city || entry.ip))
}

function isFresh(entry: CrnGeoCacheEntry | undefined): entry is CrnGeoCacheEntry {
  if (!entry) return false
  const ttl = hasResolvedGeo(entry) ? CRN_GEO_CACHE_TTL_MS : CRN_GEO_NEGATIVE_CACHE_TTL_MS
  return Date.now() - entry.fetchedAt < ttl
}

function hasLocation(crn: Crn): boolean {
  return Boolean(crnLocationLabel(crn))
}

function isIpAddress(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':')
}

function lookupHost(address: string): string {
  try {
    return new URL(address).hostname.trim().toLowerCase()
  } catch {
    return crnHost(address).trim().toLowerCase().replace(/:\d+$/, '')
  }
}

function mergeGeo(crn: Crn, entry: CrnGeoCacheEntry): Crn {
  return {
    ...crn,
    resolved_ip: crn.resolved_ip ?? entry.ip,
    city: crn.city ?? entry.city,
    region: crn.region ?? entry.region,
    country: crn.country ?? entry.country,
    country_code: crn.country_code ?? entry.country_code,
    geo_source: crn.geo_source ?? (entry.ip ? 'country.is' : null)
  }
}

async function waitForGeoLookupSlot(): Promise<void> {
  let releaseQueue!: () => void
  const previous = geoLookupQueue
  geoLookupQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve
  })

  await previous

  try {
    while (true) {
      const now = Date.now()
      while (geoLookupStartTimes.length > 0 && now - geoLookupStartTimes[0] >= GEO_LOOKUP_WINDOW_MS) {
        geoLookupStartTimes.shift()
      }

      if (geoLookupStartTimes.length < GEO_LOOKUP_RATE_LIMIT) {
        geoLookupStartTimes.push(now)
        return
      }

      const waitMs = Math.max(25, GEO_LOOKUP_WINDOW_MS - (now - geoLookupStartTimes[0]) + 1)
      logGeo('debug', `GeoIP rate limit reached, waiting ${waitMs}ms for the next slot`)
      await sleep(waitMs)
    }
  } finally {
    releaseQueue()
  }
}

async function resolveGeoEntry(host: string, fallback?: CrnGeoCacheEntry): Promise<CrnGeoCacheEntry> {
  try {
    if (!isIpAddress(host)) {
      logGeo('debug', `Resolving ${host} via shared DNS-over-HTTPS and GeoIP helpers`)
    }

    const [enriched] = await enrichCrnsWithGeoShared(
      [{ hash: `geo:${host}`, name: host, address: `https://${host}` }],
      {
        fetch: async (url, init) => {
          const requestUrl = new URL(String(url), globalThis.location?.href ?? 'https://localhost')

          if (requestUrl.hostname === 'api.country.is') {
            await waitForGeoLookupSlot()
            logGeo('debug', `Looking up GeoIP for ${host}`, { url: requestUrl.toString() })
          } else if (requestUrl.hostname === 'dns.google') {
            logGeo('debug', `Resolving ${host} via DNS-over-HTTPS`, { url: requestUrl.toString() })
          }

          const timeoutMs = requestUrl.hostname === 'dns.google' ? DNS_RESOLVE_TIMEOUT_MS : GEO_LOOKUP_TIMEOUT_MS
          return await fetchWithTimeout(requestUrl, { ...init, cache: init?.cache ?? 'no-cache' }, timeoutMs)
        },
        dnsResolveUrl: 'https://dns.google/resolve',
        countryLookupBaseUrl: COUNTRY_IS_API_BASE_URL
      }
    )

    const entry: CrnGeoCacheEntry = {
      fetchedAt: Date.now(),
      ip: enriched?.resolved_ip ?? null,
      city: enriched?.city ?? null,
      region: enriched?.region ?? null,
      country: enriched?.country ?? null,
      country_code: enriched?.country_code ?? null
    }

    if (!entry.ip && !entry.city && !entry.region && !entry.country && !entry.country_code) {
      logGeo('warn', `Falling back to empty geo entry for ${host} because no shared geo data could be resolved`)
      return fallback ?? entry
    }

    return entry
  } catch (error) {
    logGeo('warn', `Geo enrichment failed for ${host}`, error instanceof Error ? error.message : error)
    return fallback ?? {
      fetchedAt: Date.now(),
      ip: null,
      city: null,
      region: null,
      country: null,
      country_code: null
    }
  }
}

export async function enrichCrnsWithGeo(crns: Crn[]): Promise<Crn[]> {
  if (!storageAvailable() || crns.length === 0) return crns

  const cache = loadCache()
  const lookups = new Map<string, Promise<CrnGeoCacheEntry>>()

  return await Promise.all(
    crns.map(async (crn) => {
      const host = lookupHost(crn.address)
      if (!host) return crn

      const cached = cache[host]
      if (isFresh(cached)) {
        logGeo('debug', `Using cached geo entry for ${host}`, cached)
        return mergeGeo(crn, cached)
      }
      if (hasLocation(crn) && !cached) {
        logGeo('debug', `Skipping GeoIP for ${host} because CRN already exposes location metadata`)
        return crn
      }

      let lookup = lookups.get(host)
      if (!lookup) {
        lookup = resolveGeoEntry(host, cached)
        lookups.set(host, lookup)
      }

      const resolved = await lookup
      cache[host] = resolved
      saveCache(cache)
      logGeo('debug', `Stored geo cache entry for ${host}`, resolved)

      return mergeGeo(crn, resolved)
    })
  )
}
