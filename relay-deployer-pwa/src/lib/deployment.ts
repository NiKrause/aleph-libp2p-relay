import {
  buildPaymentQuote,
  createReleaseMetadata as createSharedReleaseMetadata,
  filterDeployableCrns,
  isValidSshPublicKey,
  normalizeSshPublicKey,
  quoteRequiredBudgetUnits,
  selectedTier,
  tierSpec
} from '@le-space/core'
import {
  DEFAULT_BASE_ROOTFS,
  ALEPH_DEFAULT_CHANNEL,
  PRICE_STALE_MS
} from './config'
import { ITEM_HASH_RE } from './rootfsManifest'
import type {
  AAWalletAssessment,
  BalanceResponse,
  Crn,
  DeploymentForm,
  DeploymentValidation,
  PaymentQuote,
  PricingState,
  RootfsManifest,
  RootfsResolution,
  TierSpec
} from './types'

const QUOTE_EPSILON = 1e-9

export const DEFAULT_DEPLOYMENT_FORM: DeploymentForm = {
  name: 'py-libp2p-relay',
  sshPublicKey: '',
  rootfsSourceMode: 'base',
  baseRootfs: DEFAULT_BASE_ROOTFS,
  tierId: 'tier-1',
  selectedCrnHash: ''
}

export function compatibleCrns(crns: Crn[], spec: TierSpec): Crn[] {
  return filterDeployableCrns(crns, { spec })
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
  return createSharedReleaseMetadata(name, rootfsVersion, 'aleph-relay-deployer-pwa')
}

export function prepaidValidationErrors(args: {
  aaWallet: AAWalletAssessment | null
  quote: PaymentQuote | null
  availableBalance: bigint
  currentReservationAmount: bigint
  reservationExpired: boolean
  prepaidConfigured: boolean
}): string[] {
  if (!args.prepaidConfigured) return []

  const errors: string[] = []
  const requiredBudget = quoteRequiredBudgetUnits(args.quote)

  if (!args.aaWallet) {
    errors.push('AA wallet assessment is required before prepaid deployment can proceed.')
    return errors
  }

  if (args.aaWallet.enforcementLevel !== 'contract-signature-ready') {
    errors.push('Hard prepaid enforcement is not available for the connected wallet address. Use a smart-account owner address or disable prepaid gating.')
  }

  if (args.availableBalance < requiredBudget) {
    errors.push('Insufficient prepaid budget in the configured vault.')
  }

  if (args.currentReservationAmount < requiredBudget || args.reservationExpired) {
    errors.push('Reserve the current deployment intent in the prepaid vault before signing.')
  }

  return errors
}

export {
  buildPaymentQuote,
  isValidSshPublicKey,
  normalizeSshPublicKey,
  quoteRequiredBudgetUnits,
  selectedTier,
  tierSpec
}
export { ALEPH_DEFAULT_CHANNEL }
