import { ALEPH_AGGREGATE_ADDRESS, ALEPH_API_HOST } from './config'
import { fetchWithTimeout } from './http'
import type { InstancePricing, PricingState } from './types'

export function parseInstancePricing(payload: unknown): InstancePricing {
  const data = payload as {
    data?: { pricing?: Record<string, unknown> }
    pricing?: Record<string, unknown>
  }
  const pricing = data.data?.pricing ?? data.pricing
  const instance = pricing?.instance as InstancePricing | undefined

  if (!instance?.price?.compute_unit || !instance.compute_unit || !Array.isArray(instance.tiers)) {
    throw new Error('Aleph pricing aggregate does not contain instance pricing.')
  }

  return instance
}

export async function fetchInstancePricing(apiHost = ALEPH_API_HOST): Promise<PricingState> {
  const response = await fetchWithTimeout(`${apiHost}/api/v0/aggregates/${ALEPH_AGGREGATE_ADDRESS}.json?keys=pricing`, {
    cache: 'no-cache'
  })

  if (!response.ok) {
    throw new Error(`Pricing aggregate request failed: ${response.status}`)
  }

  const payload = (await response.json()) as { data?: Record<string, unknown> }
  const pricingAggregate = payload.data?.pricing as Record<string, unknown> | undefined

  if (!pricingAggregate) {
    throw new Error('Pricing aggregate response did not include a pricing key.')
  }

  return {
    pricing: parseInstancePricing({ pricing: pricingAggregate }),
    fetchedAt: Date.now()
  }
}

export function holdSupportedTiers(pricing: InstancePricing, maxComputeUnits: number) {
  return pricing.tiers.filter((tier) => tier.compute_units <= maxComputeUnits)
}
