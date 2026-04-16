import {
  ALEPH_DEFAULT_CHANNEL,
  DEFAULT_PAYMENT_CHAIN,
  HOLD_MAX_COMPUTE_UNITS,
  PRICE_STALE_MS
} from './config'
import { toNumber } from './format'
import { ITEM_HASH_RE } from './rootfsManifest'
import type {
  BalanceResponse,
  Crn,
  DeploymentForm,
  DeploymentValidation,
  InstancePricing,
  PaymentMode,
  PaymentQuote,
  PricingState,
  RootfsManifest,
  Tier,
  TierSpec
} from './types'

export const DEFAULT_DEPLOYMENT_FORM: DeploymentForm = {
  name: 'py-libp2p-relay',
  sshPublicKey: '',
  paymentMode: 'hold',
  paymentChain: DEFAULT_PAYMENT_CHAIN,
  tierId: 'tier-1',
  selectedCrnHash: ''
}

export function selectedTier(pricing: InstancePricing | null, tierId: string): Tier | null {
  return pricing?.tiers.find((tier) => tier.id === tierId) ?? null
}

export function tierSpec(pricing: InstancePricing, tier: Tier): TierSpec {
  return {
    vcpus: pricing.compute_unit.vcpus * tier.compute_units,
    memoryMiB: pricing.compute_unit.memory_mib * tier.compute_units,
    diskMiB: pricing.compute_unit.disk_mib * tier.compute_units
  }
}

export function isHoldTierSupported(tier: Tier | null): boolean {
  return Boolean(tier && tier.compute_units <= HOLD_MAX_COMPUTE_UNITS)
}

export function compatibleCrns(crns: Crn[], spec: TierSpec): Crn[] {
  return crns.filter((crn) => {
    if (crn.qemu_support === false) return false

    const usage = crn.system_usage
    if (!usage) return true

    const cpuOk = usage.cpu?.count == null || usage.cpu.count >= spec.vcpus
    const memoryOk = usage.mem?.available_kB == null || usage.mem.available_kB >= spec.memoryMiB * 1024
    const diskOk = usage.disk?.available_kB == null || usage.disk.available_kB >= spec.diskMiB * 1024
    const activeOk = usage.active !== false

    return cpuOk && memoryOk && diskOk && activeOk
  })
}

export function buildPaymentQuote(
  mode: PaymentMode,
  tier: Tier,
  pricing: InstancePricing,
  balance: BalanceResponse
): PaymentQuote | null {
  const computeUnitPrice = pricing.price.compute_unit
  if (!computeUnitPrice) return null

  if (mode === 'hold') {
    const unitPrice = toNumber(computeUnitPrice.holding)
    const balanceAmount = toNumber(balance.balance)
    const lockedAmount = toNumber(balance.locked_amount)
    return {
      mode,
      required: unitPrice * tier.compute_units,
      available: balanceAmount - lockedAmount,
      computeUnits: tier.compute_units,
      unitPrice,
      label: 'ALEPH held'
    }
  }

  const unitPrice = toNumber(computeUnitPrice.credit)
  return {
    mode,
    required: unitPrice * tier.compute_units,
    available: Number(balance.credit_balance ?? 0),
    computeUnits: tier.compute_units,
    unitPrice,
    label: 'credits'
  }
}

export function validateDeployment(args: {
  form: DeploymentForm
  manifest: RootfsManifest | null
  pricingState: PricingState
  balance: BalanceResponse | null
  crns: Crn[]
  rootfsVerified: boolean
  now?: number
}): DeploymentValidation {
  const now = args.now ?? Date.now()
  const errors: string[] = []
  const warnings: string[] = []
  const pricing = args.pricingState.pricing
  const tier = selectedTier(pricing, args.form.tierId)
  let quote: PaymentQuote | null = null

  if (!args.manifest || !ITEM_HASH_RE.test(args.manifest.rootfsItemHash || '')) {
    errors.push('A valid custom rootfs manifest is required.')
  } else if (!args.rootfsVerified) {
    errors.push('The rootfs ItemHash has not been verified on Aleph.')
  }

  if (!args.form.name.trim()) errors.push('Instance name is required.')
  if (!args.form.sshPublicKey.trim()) errors.push('An SSH public key is required.')
  if (!pricing) errors.push('Live Aleph pricing is required.')
  if (!args.balance) errors.push('Wallet balance is required.')
  if (!tier) errors.push('Selected tier is unavailable in current pricing.')

  if (args.pricingState.fetchedAt && now - args.pricingState.fetchedAt > PRICE_STALE_MS) {
    errors.push('Pricing is stale. Refresh pricing before deploying.')
  }

  if (pricing && tier && args.balance) {
    quote = buildPaymentQuote(args.form.paymentMode, tier, pricing, args.balance)

    if (!quote || !Number.isFinite(quote.required)) {
      errors.push(`No ${args.form.paymentMode} price is available for this tier.`)
    } else if (quote.available < quote.required) {
      errors.push(`Insufficient ${quote.label}.`)
    }
  }

  if (args.form.paymentMode === 'hold') {
    if (!tier || !isHoldTierSupported(tier)) {
      errors.push('Hold payment is limited to standard instance tiers 1-3.')
    }
  }

  if (args.form.paymentMode === 'credit') {
    if (!args.form.selectedCrnHash) {
      errors.push('Credit deployments require a selected CRN.')
    } else if (!args.crns.some((crn) => crn.hash === args.form.selectedCrnHash)) {
      errors.push('Selected CRN is not in the current CRN list.')
    }
  }

  if (args.form.paymentMode === 'credit' && args.form.paymentChain) {
    warnings.push('Credit uses account credits; the chain selector is ignored for payment.')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    quote
  }
}

export function createReleaseMetadata(name: string, manifest: RootfsManifest) {
  return {
    name,
    relay: 'py-libp2p',
    rootfs_version: manifest.version,
    deployer: 'aleph-relay-deployer-pwa'
  }
}

export { ALEPH_DEFAULT_CHANNEL }
