import { describe, expect, it } from 'vitest'
import {
  compatibleCrns,
  DEFAULT_DEPLOYMENT_FORM,
  isValidSshPublicKey,
  normalizeSshPublicKey,
  validateDeployment
} from './deployment'
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
      selectedCrnHash: crns[0].hash,
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
  it('defaults new deployments to credit-backed base-image instances', () => {
    expect(DEFAULT_DEPLOYMENT_FORM.rootfsSourceMode).toBe('base')
    expect(DEFAULT_DEPLOYMENT_FORM.selectedCrnHash).toBe('')
  })

  it('accepts a funded credit deployment', () => {
    const result = validate()

    expect(result.ok).toBe(true)
    expect(result.quote?.required).toBe(14250)
    expect(result.quote?.available).toBe(60000)
  })

  it('normalizes SSH public keys to a single trimmed line', () => {
    expect(normalizeSshPublicKey('  ssh-ed25519   AAAATEST   user@host \n')).toBe('ssh-ed25519 AAAATEST user@host')
  })

  it('accepts valid SSH public keys and rejects malformed ones', () => {
    expect(isValidSshPublicKey('ssh-ed25519 AAAATEST user@host')).toBe(true)
    expect(isValidSshPublicKey('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC7')).toBe(true)
    expect(isValidSshPublicKey('not-a-key')).toBe(false)
  })

  it('accepts a deployment when available credits exactly match the requirement', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST',
        selectedCrnHash: crns[0].hash
      },
      manifest,
      rootfsResolution,
      pricingState: { pricing, fetchedAt: 1000 },
      balance: { ...balance, credit_balance: 14250 },
      crns,
      rootfsVerified: true,
      now: 1000
    })

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.quote?.required).toBe(14250)
    expect(result.quote?.available).toBe(14250)
  })

  it('accepts a funded credit deployment with a CRN', () => {
    const result = validate({
      tierId: 'tier-2',
      selectedCrnHash: crns[0].hash
    })

    expect(result.ok).toBe(true)
    expect(result.quote?.required).toBe(28500)
  })

  it('sorts compatible CRNs by descending score', () => {
    const ranked = compatibleCrns(
      [
        { ...crns[0], hash: 'c'.repeat(64), name: 'Lower', score: 71.5 },
        { ...crns[0], hash: 'd'.repeat(64), name: 'Higher', score: 92.1 },
        { ...crns[0], hash: 'e'.repeat(64), name: 'Unscored', score: null }
      ],
      { vcpus: 1, memoryMiB: 2048, diskMiB: 20480 }
    )

    expect(ranked.map((crn) => crn.name)).toEqual(['Higher', 'Lower', 'Unscored'])
  })

  it('rejects credit deployments without enough credits', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST',
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

  it('rejects deployments without a selected CRN', () => {
    const result = validate({ selectedCrnHash: '' })

    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Credit deployments require a selected CRN.')
  })

  it('rejects deployments while the rootfs store message is still pending', () => {
    const result = validateDeployment({
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST',
        selectedCrnHash: crns[0].hash
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
        sshPublicKey: 'ssh-ed25519 AAAATEST',
        selectedCrnHash: crns[0].hash
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
        baseRootfs: 'ubuntu22',
        selectedCrnHash: crns[0].hash
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
    expect(result.quote?.required).toBe(14250)
  })
})
