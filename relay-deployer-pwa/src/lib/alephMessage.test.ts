import { describe, expect, it, vi } from 'vitest'
import { createInstanceContent, createUnsignedInstanceMessage, signaturePayload, signInstanceMessage } from './alephMessage'
import { ALEPH_BASE_ROOTFS_ITEM_HASHES } from './config'
import { DEFAULT_DEPLOYMENT_FORM } from './deployment'
import type { InstancePricing, RootfsManifest, Tier } from './types'

const manifest: RootfsManifest = {
  version: 'relay-v0.1.0',
  rootfsItemHash: 'a'.repeat(64),
  rootfsSizeMiB: 20480,
  createdAt: '2026-04-15'
}

const pricing: InstancePricing = {
  price: { compute_unit: { credit: '14250' } },
  compute_unit: { vcpus: 1, memory_mib: 2048, disk_mib: 20480 },
  tiers: [{ id: 'tier-1', compute_units: 1 }]
}

const tier: Tier = { id: 'tier-1', compute_units: 1 }

describe('Aleph instance message helpers', () => {
  it('builds instance content with the pinned rootfs reference', () => {
    const content = createInstanceContent({
      address: '0xabc',
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST'
      },
      manifest,
      pricing,
      tier,
      now: 10
    })

    expect(content.rootfs.parent.ref).toBe(manifest.rootfsItemHash)
    expect(content.rootfs.persistence).toBe('host')
    expect(content.allow_amend).toBe(false)
    expect(content.resources.memory).toBe(2048)
    expect(content.resources.seconds).toBe(30)
    expect(content.environment.internet).toBe(true)
    expect(content.environment.aleph_api).toBe(true)
    expect(content.environment.reproducible).toBe(false)
    expect(content.environment.shared_cache).toBe(false)
    expect(content.payment.type).toBe('credit')
    expect(content.payment.chain).toBeUndefined()
  })

  it('builds instance content with an Aleph base-image rootfs reference', () => {
    const content = createInstanceContent({
      address: '0xabc',
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'base',
        baseRootfs: 'debian12',
        sshPublicKey: 'ssh-ed25519 AAAATEST'
      },
      manifest: null,
      pricing,
      tier,
      now: 10
    })

    expect(content.rootfs.parent.ref).toBe(ALEPH_BASE_ROOTFS_ITEM_HASHES.debian12)
    expect(content.rootfs.parent.use_latest).toBe(true)
    expect(content.rootfs.size_mib).toBe(20480)
  })

  it('creates the exact Aleph signature payload shape', async () => {
    const content = createInstanceContent({
      address: '0xabc',
      form: {
        ...DEFAULT_DEPLOYMENT_FORM,
        rootfsSourceMode: 'custom',
        sshPublicKey: 'ssh-ed25519 AAAATEST'
      },
      manifest,
      pricing,
      tier,
      now: 10
    })
    const unsigned = await createUnsignedInstanceMessage({
      sender: '0xabc',
      content,
      now: 20
    })

    expect(signaturePayload(unsigned)).toBe(`ETH\n0xabc\nINSTANCE\n${unsigned.item_hash}`)
    expect(unsigned.item_type).toBe('inline')
  })

  it('uses a MetaMask-compatible signer', async () => {
    const signer = vi.fn(async () => '1234')
    const message = await signInstanceMessage(
      {
        sender: '0xabc',
        chain: 'ETH',
        type: 'INSTANCE',
        item_hash: 'f'.repeat(64),
        item_type: 'inline',
        item_content: '{}',
        time: 20,
        channel: 'ALEPH-CLOUDSOLUTIONS'
      },
      signer
    )

    expect(signer).toHaveBeenCalledWith('0xabc', `ETH\n0xabc\nINSTANCE\n${'f'.repeat(64)}`)
    expect(message.signature).toBe('0x1234')
  })
})
