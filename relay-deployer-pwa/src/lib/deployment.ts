import {
  DEFAULT_BASE_ROOTFS,
  ALEPH_DEFAULT_CHANNEL,
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
  PaymentQuote,
  PricingState,
  RootfsManifest,
  RootfsResolution,
  Tier,
  TierSpec
} from './types'

const QUOTE_EPSILON = 1e-9
const SSH_PUBLIC_KEY_PATTERN =
  /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/]+={0,3}(?:\s+.+)?$/

export const DEFAULT_DEPLOYMENT_FORM: DeploymentForm = {
  name: 'py-libp2p-relay',
  sshPublicKey: '',
  rootfsSourceMode: 'base',
  baseRootfs: DEFAULT_BASE_ROOTFS,
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

export function compatibleCrns(crns: Crn[], spec: TierSpec): Crn[] {
  return [...crns]
    .filter((crn) => {
      if (crn.qemu_support === false) return false

      const usage = crn.system_usage
      if (!usage) return true

      const cpuOk = usage.cpu?.count == null || usage.cpu.count >= spec.vcpus
      const memoryOk = usage.mem?.available_kB == null || usage.mem.available_kB >= spec.memoryMiB * 1024
      const diskOk = usage.disk?.available_kB == null || usage.disk.available_kB >= spec.diskMiB * 1024
      const activeOk = usage.active !== false

      return cpuOk && memoryOk && diskOk && activeOk
    })
    .sort((left, right) => {
      const rightScore = toNumber(right.score)
      const leftScore = toNumber(left.score)
      const normalizedRight = Number.isFinite(rightScore) ? rightScore : Number.NEGATIVE_INFINITY
      const normalizedLeft = Number.isFinite(leftScore) ? leftScore : Number.NEGATIVE_INFINITY

      if (normalizedRight !== normalizedLeft) return normalizedRight - normalizedLeft

      const leftName = (left.name || left.address || left.hash).toLowerCase()
      const rightName = (right.name || right.address || right.hash).toLowerCase()
      return leftName.localeCompare(rightName)
    })
}

export function buildPaymentQuote(tier: Tier, pricing: InstancePricing, balance: BalanceResponse): PaymentQuote | null {
  const computeUnitPrice = pricing.price.compute_unit
  if (!computeUnitPrice) return null

  const unitPrice = toNumber(computeUnitPrice.credit)
  return {
    required: unitPrice * tier.compute_units,
    available: Number(balance.credit_balance ?? 0),
    computeUnits: tier.compute_units,
    unitPrice,
    label: 'credits'
  }
}

export function normalizeSshPublicKey(value: string): string {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isValidSshPublicKey(value: string): boolean {
  const normalized = normalizeSshPublicKey(value)
  return SSH_PUBLIC_KEY_PATTERN.test(normalized)
}

export function validateDeployment(args: {
  form: DeploymentForm
  manifest: RootfsManifest | null
  rootfsResolution: RootfsResolution | null
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

  if (args.form.rootfsSourceMode === 'custom') {
    if (!args.manifest || !ITEM_HASH_RE.test(args.manifest.rootfsItemHash || '')) {
      errors.push('A valid custom rootfs manifest is required.')
    } else if (!args.rootfsVerified) {
      errors.push('The rootfs ItemHash has not been verified on Aleph.')
    } else if (args.rootfsResolution) {
      if (args.rootfsResolution.messageStatus === 'pending') {
        if (args.rootfsResolution.gatewayStatus === 'reachable') {
          warnings.push(
            'The rootfs STORE message is still pending on Aleph, but the CID gateway is reachable. Deploying now is allowed in caution mode.'
          )
        } else {
          errors.push('The rootfs STORE message is pending on Aleph. Wait until it is processed before deploying.')
        }
      } else if (args.rootfsResolution.messageStatus !== 'processed') {
        errors.push(`The rootfs STORE message is ${args.rootfsResolution.messageStatus} on Aleph. Wait until it is processed before deploying.`)
      }
    }
  }

  if (!args.form.name.trim()) errors.push('Instance name is required.')

  const normalizedSshKey = normalizeSshPublicKey(args.form.sshPublicKey)
  if (!normalizedSshKey) {
    errors.push('An SSH public key is required.')
  } else if (!isValidSshPublicKey(normalizedSshKey)) {
    errors.push('SSH public key must be a single valid .pub line, including the key type and base64 payload.')
  }
  if (!pricing) errors.push('Live Aleph pricing is required.')
  if (!args.balance) errors.push('Wallet balance is required.')
  if (!tier) errors.push('Selected tier is unavailable in current pricing.')

  if (args.pricingState.fetchedAt && now - args.pricingState.fetchedAt > PRICE_STALE_MS) {
    errors.push('Pricing is stale. Refresh pricing before deploying.')
  }

  if (pricing && tier && args.balance) {
    quote = buildPaymentQuote(tier, pricing, args.balance)

    if (!quote || !Number.isFinite(quote.required)) {
      errors.push('No credit price is available for this tier.')
    } else if (quote.available + QUOTE_EPSILON < quote.required) {
      errors.push(`Insufficient ${quote.label}.`)
    }
  }

  if (!args.form.selectedCrnHash) {
    errors.push('Credit deployments require a selected CRN.')
  } else if (!args.crns.some((crn) => crn.hash === args.form.selectedCrnHash)) {
    errors.push('Selected CRN is not in the current CRN list.')
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    quote
  }
}

export function createReleaseMetadata(name: string, rootfsVersion: string) {
  return {
    name,
    rootfs_version: rootfsVersion,
    deployer: 'aleph-relay-deployer-pwa'
  }
}

export { ALEPH_DEFAULT_CHANNEL }
