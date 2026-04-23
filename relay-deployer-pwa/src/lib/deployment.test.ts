import { describe, expect, it } from 'vitest'
import { DEFAULT_DEPLOYMENT_FORM, estimateRootfsStorageHolding, validateDeployment } from './deployment'
import type { BalanceResponse, Crn, InstancePricing, RootfsManifest, RootfsResolution } from './types'

const manifest: RootfsManifest = {
  version: 'relay-v0.1.0',
  rootfsItemHash: 'a'.repeat(64),
  rootfsSizeMiB: 20480,
  rootfsSourceSizeBytes: 2445860819,
  createdAt: '2026-04-15'
}

const pricing: InstancePricing = {
  price: {
    storage: {
      holding: '0.33333'
    },
    compute_unit: {
      holding: '1000',
      credit: '14250'
    }
  },
  compute_unit: {
    vcpus: 1,
    memory_mib: 2048,
    disk_mib: 20480
  },
  tiers: [
    { id: 'tier-1', compute_units: 1 },
    { id: 'tier-2', compute_units: 2 },
    { id: 'tier-3', compute_units: 4 },
    { id: 'tier-4', compute_units: 6 }
  ]
}

const balance: BalanceResponse = {
  address: '0x123',
  balance: '4500',
  locked_amount: '500',
  credit_balance: 60000
}

const crns: Crn[] = [
  {
    hash: 'b'.repeat(64),
    name: 'Relay CRN',
    address: 'https://crn.example'
  }
]

const rootfsResolution: RootfsResolution = {
  itemHash: manifest.rootfsItemHash,
  messageStatus: 'processed',
  messageType: 'STORE',
  cid: 'QmExampleCid',
  receptionTime: '2026-04-16T13:28:47.044481Z',
  gatewayUrl: 'https://ipfs.aleph.cloud/ipfs/QmExampleCid',
  gatewayStatus: 'reachable',
  gatewayError: null
}

function validate(overrides = {}) {
  return validateDeployment({
    form: {
      ...DEFAULT_DEPLOYMENT_FORM,
      rootfsSourceMode: 'custom',
      sshPublicKey: 'ssh-ed25519 AAAATEST',
      ...overrides
    },
    manifest,
    rootfsResolution,
    pricingState: { pricing, fetchedAt: 1000 },
    balance,
    crns,
    rootfsVerified: true,
    now: 1000
  })
}

describe('validateDeployment', () => {
  it('defaults hold deployments to the ETH payment chain', () => {
    expect(DEFAULT_DEPLOYMENT_FORM.paymentMode).toBe('hold')
    expect(DEFAULT_DEPLOYMENT_FORM.paymentChain).toBe('ETH')
  })

  it('estimates rootfs storage holding from source size and live storage pricing', () => {
    expect(estimateRootfsStorageHolding(manifest, pricing)).toBeCloseTo(777.5104, 4)
  })

  it('accepts a funded hold deployment', () => {
    const result = validate()

    expect(result.ok).toBe(true)
    expect(result.quote?.required).toBe(1000)
    expect(result.quote?.available).toBe(4000)
  })

  it('accepts a hold deployment when available ALEPH exactly matches the requirement', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST'
      },
      manifest,
      rootfsResolution,
      pricingState: { pricing, fetchedAt: 1000 },
      balance: { ...balance, balance: '1000', locked_amount: '0' },
      crns,
      rootfsVerified: true,
      now: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.quote?.required).toBe(1000)
    expect(result.quote?.available).toBe(1000)
  })

  it('rejects hold deployments above tier 3', () => {
    const result = validate({ tierId: 'tier-4' })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Hold payment is limited to standard instance tiers 1-3.')
  })

  it('uses unlocked ALEPH for hold balance checks', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST',
        tierId: 'tier-3'
      },
      manifest,
      rootfsResolution,
      pricingState: { pricing, fetchedAt: 1000 },
      balance: { ...balance, balance: '4500', locked_amount: '1000' },
      crns,
      rootfsVerified: true,
      now: 1000
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Insufficient ALEPH held.')
  })

  it('accepts a funded credit deployment with a CRN', () => {
    const result = validate({
      paymentMode: 'credit',
      tierId: 'tier-2',
      selectedCrnHash: crns[0].hash
    })

    expect(result.ok).toBe(true)
    expect(result.quote?.required).toBe(28500)
  })

  it('rejects credit deployments without enough credits', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST',
        paymentMode: 'credit',
        selectedCrnHash: crns[0].hash
      },
      manifest,
      rootfsResolution,
      pricingState: { pricing, fetchedAt: 1000 },
      balance: { ...balance, credit_balance: 1000 },
      crns,
      rootfsVerified: true,
      now: 1000
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Insufficient credits.')
  })

  it('rejects deployments while the rootfs store message is still pending', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST'
      },
      manifest,
      rootfsResolution: { ...rootfsResolution, messageStatus: 'pending', gatewayStatus: 'timeout' },
      pricingState: { pricing, fetchedAt: 1000 },
      balance,
      crns,
      rootfsVerified: true,
      now: 1000
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('The rootfs STORE message is pending on Aleph. Wait until it is processed before deploying.')
  })

  it('allows caution deployments when the rootfs store message is pending but the cid gateway is reachable', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST'
      },
      manifest,
      rootfsResolution: { ...rootfsResolution, messageStatus: 'pending', gatewayStatus: 'reachable' },
      pricingState: { pricing, fetchedAt: 1000 },
      balance,
      crns,
      rootfsVerified: true,
      now: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings).toContain(
      'The rootfs STORE message is still pending on Aleph, but the CID gateway is reachable. Deploying now is allowed in caution mode.'
    )
  })

  it('rejects stale pricing', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST'
      },
      manifest,
      rootfsResolution,
      pricingState: { pricing, fetchedAt: 1 },
      balance,
      crns,
      rootfsVerified: true,
      now: 6 * 60 * 1000
    })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Pricing is stale. Refresh pricing before deploying.')
  })

  it('accepts an Aleph base-image deployment without a custom manifest', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        sshPublicKey: 'ssh-ed25519 AAAATEST',
        rootfsSourceMode: 'base',
        baseRootfs: 'ubuntu22'
      },
      manifest: null,
      rootfsResolution: null,
      pricingState: { pricing, fetchedAt: 1000 },
      balance,
      crns,
      rootfsVerified: false,
      now: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.quote?.required).toBe(1000)
  })
})
