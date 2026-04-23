<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchBalance, fetchCrns, fetchInstanceRuntimeDetails, fetchInstances, waitForDeploymentResult } from './lib/alephApi'
  import { deleteInstance } from './lib/alephForget'
  import { deployInstance } from './lib/alephMessage'
  import {
    DEFAULT_DEPLOYMENT_FORM,
    compatibleCrns,
    estimateRootfsStorageHolding,
    selectedTier,
    tierSpec,
    validateDeployment
  } from './lib/deployment'
  import { crnDisplayLabel, explorerUrl, apiMessageUrl, dateLabel, formatNumber, shortHash } from './lib/format'
  import { fetchInstancePricing, holdSupportedTiers } from './lib/pricing'
  import { loadRootfsManifest, resolveRootfsReference, verifyRootfsExists } from './lib/rootfsManifest'
  import { connectWallet, fetchAlephTokenBalance, switchPaymentChain, type WalletState } from './lib/wallet'
  import {
    ALEPH_BASE_ROOTFS_OPTIONS,
    ALEPH_HOLDING_DOCS_URL,
    ALEPH_INSTANCE_DOCS_URL,
    ALEPH_SUPPORTED_CHAINS_DOCS_URL,
    HOLD_MAX_COMPUTE_UNITS
  } from './lib/config'
  import type {
    BalanceResponse,
    Crn,
    DeploymentForm,
    DeploymentResult,
    InstanceMessage,
    InstanceRuntimeDetails,
    PricingState,
    RootfsManifestState,
    RootfsResolution,
    Tier
  } from './lib/types'

  let form: DeploymentForm = { ...DEFAULT_DEPLOYMENT_FORM }
  let wallet: WalletState | null = null
  let balance: BalanceResponse | null = null
  let rootfsState: RootfsManifestState = { manifest: null, valid: false, errors: ['Rootfs manifest not loaded.'] }
  let rootfsVerified = false
  let rootfsResolution: RootfsResolution | null = null
  let pricingState: PricingState = { pricing: null, fetchedAt: null }
  let crns: Crn[] = []
  let instances: InstanceMessage[] = []
  let instanceDetails: Record<string, InstanceRuntimeDetails> = {}
  let instanceDetailsBusy = false
  let instanceDetailsError = ''
  let instanceDetailsRequestKey = ''
  let instanceDetailsRefreshNonce = 0
  let deploymentResult: DeploymentResult | null = null
  let deletingInstanceHash = ''
  let instanceActionFeedback: Record<string, { tone: 'info' | 'error'; message: string }> = {}
  let networkBusy = false
  let walletBusy = false
  let deployBusy = false
  let statusText = 'Ready'
  let errorText = ''
  let selectedChainWalletBalance: number | null = null
  let selectedChainWalletBalanceError = ''
  let selectedChainWalletBalanceBusy = false
  let selectedChainBalanceRequestKey = ''
  let sshPublicKeyStorageReady = false
  const paymentChains: DeploymentForm['paymentChain'][] = ['ETH', 'BASE', 'AVAX']
  const rootfsSourceModes: DeploymentForm['rootfsSourceMode'][] = ['base', 'custom']
  const SSH_PUBLIC_KEY_STORAGE_KEY = 'aleph-relay-deployer:ssh-public-key'

  $: pricing = pricingState.pricing
  $: tier = selectedTier(pricing, form.tierId)
  $: spec = pricing && tier ? tierSpec(pricing, tier) : null
  $: crnOptions = spec ? compatibleCrns(crns, spec) : []
  $: usingBaseRootfs = form.rootfsSourceMode === 'base'
  $: selectedBaseRootfs = ALEPH_BASE_ROOTFS_OPTIONS.find((option) => option.id === form.baseRootfs) ?? ALEPH_BASE_ROOTFS_OPTIONS[0]
  $: rootfsMessageStatus = rootfsResolution?.messageStatus ?? null
  $: rootfsReady = usingBaseRootfs || (rootfsState.valid && rootfsVerified && rootfsMessageStatus === 'processed')
  $: rootfsPending = !usingBaseRootfs && rootfsState.valid && rootfsVerified && rootfsMessageStatus === 'pending'
  $: rootfsRejected = !usingBaseRootfs && rootfsState.valid && rootfsVerified && rootfsMessageStatus === 'rejected'
  $: rootfsCautionDeploy = !usingBaseRootfs && rootfsPending && rootfsResolution?.gatewayStatus === 'reachable'
  $: rootfsStatusLabel = usingBaseRootfs
    ? 'managed by Aleph'
    : rootfsReady
      ? 'processed on Aleph'
      : rootfsPending
        ? 'pending on Aleph'
        : rootfsRejected
          ? 'rejected on Aleph'
          : rootfsVerified
            ? rootfsMessageStatus ?? 'verifying on Aleph'
            : 'not verified'
  $: rootfsDisplayLabel = usingBaseRootfs
    ? selectedBaseRootfs.label
    : rootfsState.manifest?.version ?? 'missing'
  $: rootfsStorageHolding = usingBaseRootfs ? null : estimateRootfsStorageHolding(rootfsState.manifest, pricing)
  $: rootfsSourceSizeMiB = !usingBaseRootfs && rootfsState.manifest?.rootfsSourceSizeBytes
    ? rootfsState.manifest.rootfsSourceSizeBytes / (1024 * 1024)
    : null
  $: rootfsInstallStrategy = usingBaseRootfs ? 'aleph-base' : rootfsState.manifest?.rootfsInstallStrategy ?? null
  $: rootfsBootstrapNetworkRequired = !usingBaseRootfs && rootfsState.manifest?.requiresBootstrapNetwork === true
  $: rootfsBootstrapSummary = usingBaseRootfs
    ? `${selectedBaseRootfs.label} is provided by Aleph and does not require a custom STORE message.`
    : rootfsState.manifest?.bootstrapSummary?.trim() || null
  $: alephRecognizedBalance = balance ? Number(balance.balance) : null
  $: alephLockedAmount = balance ? Number(balance.locked_amount) : null
  $: availableAleph = balance ? Math.max(0, Number(balance.balance) - Number(balance.locked_amount)) : null
  $: selectedChainRecognizedBalance =
    balance?.details && balance.details[form.paymentChain] != null ? Number(balance.details[form.paymentChain]) : null
  $: recognizedChainBalances = balance?.details
    ? Object.entries(balance.details)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([chain, amount]) => `${chain}: ${formatNumber(Number(amount), 4)}`)
    : []
  $: totalHoldRequirement =
    form.paymentMode === 'hold' && validation.quote?.label === 'ALEPH held' && rootfsStorageHolding != null
      ? validation.quote.required + rootfsStorageHolding
      : null
  $: computeHoldShortfall =
    form.paymentMode === 'hold' && validation.quote?.label === 'ALEPH held' && availableAleph != null
      ? Math.max(0, validation.quote.required - availableAleph)
      : null
  $: totalHoldShortfall =
    form.paymentMode === 'hold' && totalHoldRequirement != null && availableAleph != null
      ? Math.max(0, totalHoldRequirement - availableAleph)
      : null
  $: rootfsPinningShortfall =
    form.paymentMode === 'hold' && rootfsStorageHolding != null && availableAleph != null
      ? Math.max(0, rootfsStorageHolding - availableAleph)
      : null
  $: validation = validateDeployment({
    form,
    manifest: rootfsState.manifest,
    rootfsResolution,
    pricingState,
    balance,
    crns,
    rootfsVerified
  })
  $: availableTiers = pricing
    ? form.paymentMode === 'hold'
      ? holdSupportedTiers(pricing, HOLD_MAX_COMPUTE_UNITS)
      : pricing.tiers
    : []
  $: if (sshPublicKeyStorageReady) persistSshPublicKey(form.sshPublicKey)
  $: {
    const currentWallet = wallet
    const requestKey = currentWallet ? `${currentWallet.address}:${form.paymentChain}` : ''

    if (!currentWallet) {
      selectedChainBalanceRequestKey = ''
      selectedChainWalletBalance = null
      selectedChainWalletBalanceError = ''
    } else if (requestKey !== selectedChainBalanceRequestKey) {
      selectedChainBalanceRequestKey = requestKey
      void refreshSelectedChainWalletBalance(currentWallet.address, form.paymentChain)
    }
  }
  $: {
    const currentWallet = wallet
    const requestKey = currentWallet
      ? `${currentWallet.address}:${crns.map((crn) => crn.hash).join(',')}:${instances.map((instance) => instance.item_hash).join(',')}:${instanceDetailsRefreshNonce}`
      : ''

    if (!currentWallet || instances.length === 0) {
      instanceDetailsRequestKey = ''
      instanceDetails = {}
      instanceDetailsBusy = false
      instanceDetailsError = ''
    } else if (requestKey && requestKey !== instanceDetailsRequestKey) {
      instanceDetailsRequestKey = requestKey
      void refreshInstanceDetails(currentWallet.address, instances, crns, requestKey)
    }
  }

  onMount(() => {
    loadStoredSshPublicKey()
    sshPublicKeyStorageReady = true
    void boot()
  })

  type BusyScope = 'network' | 'wallet' | 'deploy'

  function setBusy(scope: BusyScope, value: boolean) {
    if (scope === 'network') networkBusy = value
    if (scope === 'wallet') walletBusy = value
    if (scope === 'deploy') deployBusy = value
  }

  async function runTask(label: string, task: () => Promise<void>, scope: BusyScope = 'network') {
    setBusy(scope, true)
    errorText = ''
    statusText = label
    try {
      await task()
      if (statusText === label) statusText = 'Ready'
    } catch (error) {
      errorText = error instanceof Error ? error.message : String(error)
      statusText = 'Needs attention'
    } finally {
      setBusy(scope, false)
    }
  }

  async function boot() {
    await runTask('Loading network data', async () => {
      const loadErrors: string[] = []
      const [manifestResult, pricingResult, crnResult] = await Promise.allSettled([
        loadRootfsManifest(),
        fetchInstancePricing(),
        fetchCrns()
      ])

      if (manifestResult.status === 'fulfilled') {
        rootfsState = manifestResult.value
      } else {
        rootfsState = {
          manifest: null,
          valid: false,
          errors: [manifestResult.reason instanceof Error ? manifestResult.reason.message : String(manifestResult.reason)]
        }
      }

      if (pricingResult.status === 'fulfilled') {
        pricingState = pricingResult.value
      } else {
        loadErrors.push(`Pricing: ${pricingResult.reason instanceof Error ? pricingResult.reason.message : String(pricingResult.reason)}`)
      }

      if (crnResult.status === 'fulfilled') {
        crns = crnResult.value
      } else {
        loadErrors.push(`CRNs: ${crnResult.reason instanceof Error ? crnResult.reason.message : String(crnResult.reason)}`)
      }

      if (rootfsState.valid && rootfsState.manifest) {
        try {
          rootfsVerified = await verifyRootfsExists(rootfsState.manifest.rootfsItemHash)
          rootfsResolution = await resolveRootfsReference(rootfsState.manifest.rootfsItemHash)
        } catch (error) {
          rootfsVerified = false
          rootfsResolution = null
          loadErrors.push(`Rootfs verification: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      selectCompatibleTier()
      selectDefaultCrn()

      if (loadErrors.length) {
        errorText = loadErrors.join(' ')
        statusText = 'Ready with warnings'
      }
    })
  }

  function loadStoredSshPublicKey() {
    if (typeof window === 'undefined') return

    try {
      const storedValue = window.localStorage.getItem(SSH_PUBLIC_KEY_STORAGE_KEY)
      if (!storedValue) return

      form = {
        ...form,
        sshPublicKey: storedValue
      }
    } catch {
      // Ignore storage access failures and keep the form usable.
    }
  }

  function persistSshPublicKey(value: string) {
    if (typeof window === 'undefined') return

    try {
      if (value.trim()) {
        window.localStorage.setItem(SSH_PUBLIC_KEY_STORAGE_KEY, value)
      } else {
        window.localStorage.removeItem(SSH_PUBLIC_KEY_STORAGE_KEY)
      }
    } catch {
      // Ignore storage access failures and keep the form usable.
    }
  }

  function selectCompatibleTier() {
    if (!pricing) return
    const validIds = new Set(availableTiers.map((item) => item.id))
    if (!validIds.has(form.tierId) && availableTiers[0]) {
      form = { ...form, tierId: availableTiers[0].id }
    }
  }

  function selectDefaultCrn() {
    if (form.paymentMode !== 'credit') return
    if (form.selectedCrnHash && crnOptions.some((crn) => crn.hash === form.selectedCrnHash)) return
    form = { ...form, selectedCrnHash: crnOptions[0]?.hash ?? '' }
  }

  async function connect() {
    await runTask('Connecting wallet', async () => {
      const connectedWallet = await connectWallet()
      wallet = connectedWallet

      const [balanceResult, instancesResult] = await Promise.allSettled([
        fetchBalance(connectedWallet.address),
        fetchInstances(connectedWallet.address)
      ])

      const connectErrors: string[] = []
      if (balanceResult.status === 'fulfilled') {
        balance = balanceResult.value
      } else {
        connectErrors.push(`Balance: ${balanceResult.reason instanceof Error ? balanceResult.reason.message : String(balanceResult.reason)}`)
      }

      if (instancesResult.status === 'fulfilled') {
        instances = instancesResult.value
      } else {
        connectErrors.push(`Instances: ${instancesResult.reason instanceof Error ? instancesResult.reason.message : String(instancesResult.reason)}`)
      }

      if (connectErrors.length) {
        throw new Error(`Wallet connected, but Aleph data failed. ${connectErrors.join(' ')}`)
      }

      instanceDetailsRefreshNonce += 1
    }, 'wallet')
  }

  async function refresh() {
    await runTask('Refreshing Aleph data', async () => {
      const refreshErrors: string[] = []
      const connectedWallet = wallet
      const [pricingResult, crnResult, balanceResult, instancesResult] = await Promise.allSettled([
        fetchInstancePricing(),
        fetchCrns(),
        connectedWallet ? fetchBalance(connectedWallet.address) : Promise.resolve(null),
        connectedWallet ? fetchInstances(connectedWallet.address) : Promise.resolve(null)
      ])

      if (pricingResult.status === 'fulfilled') {
        pricingState = pricingResult.value
      } else {
        refreshErrors.push(`Pricing: ${pricingResult.reason instanceof Error ? pricingResult.reason.message : String(pricingResult.reason)}`)
      }

      if (crnResult.status === 'fulfilled') {
        crns = crnResult.value
      } else {
        refreshErrors.push(`CRNs: ${crnResult.reason instanceof Error ? crnResult.reason.message : String(crnResult.reason)}`)
      }

      if (balanceResult.status === 'fulfilled' && balanceResult.value) {
        balance = balanceResult.value
      } else if (balanceResult.status === 'rejected') {
        refreshErrors.push(`Balance: ${balanceResult.reason instanceof Error ? balanceResult.reason.message : String(balanceResult.reason)}`)
      }

      if (instancesResult.status === 'fulfilled' && instancesResult.value) {
        instances = instancesResult.value
      } else if (instancesResult.status === 'rejected') {
        refreshErrors.push(`Instances: ${instancesResult.reason instanceof Error ? instancesResult.reason.message : String(instancesResult.reason)}`)
      }

      if (rootfsState.valid && rootfsState.manifest) {
        try {
          rootfsVerified = await verifyRootfsExists(rootfsState.manifest.rootfsItemHash)
          rootfsResolution = await resolveRootfsReference(rootfsState.manifest.rootfsItemHash)
        } catch (error) {
          rootfsVerified = false
          rootfsResolution = null
          refreshErrors.push(`Rootfs verification: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      selectCompatibleTier()
      selectDefaultCrn()

      if (refreshErrors.length) {
        throw new Error(refreshErrors.join(' '))
      }

      instanceDetailsRefreshNonce += 1
    })
  }

  async function refreshInstancesOnly() {
    if (!wallet) return
    const connectedWallet = wallet
    await runTask('Refreshing instances', async () => {
      instances = await fetchInstances(connectedWallet.address)
      balance = await fetchBalance(connectedWallet.address)
      instanceDetailsRefreshNonce += 1
    })
  }

  async function refreshInstanceDetails(
    address: string,
    nextInstances: InstanceMessage[],
    nextCrns: Crn[],
    requestKey: string
  ) {
    instanceDetailsBusy = true
    instanceDetailsError = ''

    try {
      const details = await fetchInstanceRuntimeDetails(nextInstances, nextCrns)
      if (wallet?.address === address && instanceDetailsRequestKey === requestKey) {
        instanceDetails = details
      }
    } catch (error) {
      if (wallet?.address === address && instanceDetailsRequestKey === requestKey) {
        instanceDetails = {}
        instanceDetailsError = error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (wallet?.address === address && instanceDetailsRequestKey === requestKey) {
        instanceDetailsBusy = false
      }
    }
  }

  function setPaymentMode(mode: DeploymentForm['paymentMode']) {
    form = {
      ...form,
      paymentMode: mode,
      selectedCrnHash: mode === 'credit' ? form.selectedCrnHash || crnOptions[0]?.hash || '' : ''
    }
    selectCompatibleTier()
    selectDefaultCrn()
  }

  async function submitDeployment() {
    await runTask('Preparing deployment', async () => {
      if (!wallet) throw new Error('Connect MetaMask before deployment.')
      if (!pricing || !tier || (!usingBaseRootfs && !rootfsState.manifest)) throw new Error('Network data is incomplete.')
      if (!validation.ok) throw new Error(validation.errors.join(' '))

      if (form.paymentMode === 'hold') {
        statusText = `Switching to ${form.paymentChain}`
        await switchPaymentChain(form.paymentChain)
      }

      const selectedCrn = form.selectedCrnHash
        ? crns.find((crn) => crn.hash === form.selectedCrnHash) ?? null
        : null

      statusText = 'Signing Aleph message'
      deploymentResult = await deployInstance({
        sender: wallet.address,
        form,
        manifest: usingBaseRootfs ? null : rootfsState.manifest,
        pricing,
        tier,
        selectedCrn
      })

      if (deploymentResult.status !== 'processed') {
        statusText = 'Waiting for Aleph validation'
        const finalResult = await waitForDeploymentResult(
          deploymentResult.itemHash,
          usingBaseRootfs ? undefined : rootfsState.manifest?.rootfsItemHash
        )
        deploymentResult = {
          ...deploymentResult,
          status: finalResult.status,
          errorCode: finalResult.errorCode,
          rejectionReason: finalResult.rejectionReason,
          references: finalResult.references,
          details: finalResult.details
        }
      }

      instances = await fetchInstances(wallet.address)
      balance = await fetchBalance(wallet.address)
      instanceDetailsRefreshNonce += 1

      if (deploymentResult.status === 'rejected') {
        statusText = 'Deployment rejected'
      } else if (deploymentResult.status === 'processed') {
        statusText = 'Deployment processed'
      }
    }, 'deploy')
  }

  function tierLabel(tier: Tier) {
    if (!pricing) return tier.id
    const nextSpec = tierSpec(pricing, tier)
    return `${tier.id.replace('tier-', 'Tier ')} - ${nextSpec.vcpus} vCPU / ${formatNumber(nextSpec.memoryMiB / 1024, 1)} GiB`
  }

  function instanceName(instance: InstanceMessage) {
    return instance.content?.metadata?.name || 'Aleph instance'
  }

  function instanceStatusLabel(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    const status = (details?.messageStatus ?? instance.status ?? '').toLowerCase()

    if (status === 'processed') return 'Confirmed'
    if (status === 'pending') return 'Pending'
    if (status === 'rejected') return 'Rejected'
    if (status === 'removing') return 'Removing'
    return status || 'Unknown'
  }

  function runtimeStatusLabel(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    const execution = instanceDetails[instance.item_hash]?.execution
    const status = execution?.status

    if (!execution) {
      if (details?.allocation?.crnUrl) return 'Not running on CRN yet'
      if (details?.messageStatus === 'processed') return 'Awaiting allocation'
      return 'Awaiting runtime details'
    }
    if (status?.stopped_at) return 'Stopped'
    if (status?.stopping_at) return 'Stopping'
    if (status?.started_at || execution.running) return 'Running'
    if (status?.starting_at) return 'Starting'
    if (status?.prepared_at) return 'Prepared'
    if (status?.preparing_at || status?.defined_at) return 'Preparing'
    return execution.version === 'v1' ? 'Running' : 'Allocated'
  }

  function instanceConfirmedAt(instance: InstanceMessage) {
    return instance.reception_time || instanceDetails[instance.item_hash]?.execution?.status?.started_at || null
  }

  function instanceCrnLabel(instance: InstanceMessage) {
    const crnUrl = instanceDetails[instance.item_hash]?.allocation?.crnUrl
    if (!crnUrl) return null

    try {
      return new URL(crnUrl).host
    } catch {
      return crnUrl
    }
  }

  function instanceIpv4(instance: InstanceMessage) {
    const networking = instanceDetails[instance.item_hash]?.execution?.networking
    return networking?.host_ipv4 || networking?.ipv4 || null
  }

  function instanceIpv6(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    return details?.execution?.networking?.ipv6_ip || details?.execution?.networking?.ipv6 || details?.allocation?.vmIpv6 || null
  }

  function instanceSshCommand(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    const networking = details?.execution?.networking
    const sshPort = networking?.mapped_ports?.['22']?.host
    const hostIpv4 = networking?.host_ipv4
    const ipv6 = networking?.ipv6_ip || networking?.ipv6 || details?.allocation?.vmIpv6

    if (hostIpv4 && sshPort) return `ssh root@${hostIpv4} -p ${sshPort} -i <ssh-private-key>`
    if (ipv6) return `ssh root@${ipv6} -i <ssh-private-key>`
    return null
  }

  function mappedPorts(instance: InstanceMessage) {
    return Object.entries(instanceDetails[instance.item_hash]?.execution?.networking?.mapped_ports ?? {})
  }

  function runtimeDetailsNote(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    const crnLabel = instanceCrnLabel(instance)

    if (details?.execution) return null
    if (details?.allocation?.crnUrl && crnLabel) {
      return `${crnLabel} has been selected, but it is not exposing this VM in its execution list yet.`
    }
    if (details?.messageStatus === 'processed') {
      return 'This deployment is confirmed on Aleph, but runtime allocation details are not available yet.'
    }
    return null
  }

  async function refreshSelectedChainWalletBalance(address: string, chain: DeploymentForm['paymentChain']) {
    selectedChainWalletBalanceBusy = true
    selectedChainWalletBalanceError = ''

    try {
      selectedChainWalletBalance = await fetchAlephTokenBalance(address, chain)
    } catch (error) {
      selectedChainWalletBalance = null
      selectedChainWalletBalanceError = error instanceof Error ? error.message : String(error)
    } finally {
      selectedChainWalletBalanceBusy = false
    }
  }

  function canDeleteInstance(instance: InstanceMessage) {
    const status = (instanceDetails[instance.item_hash]?.messageStatus ?? instance.status ?? '').toLowerCase()
    return Boolean(wallet) && !deletingInstanceHash && status !== 'removing'
  }

  async function deleteDeployment(instance: InstanceMessage) {
    if (!wallet) throw new Error('Connect MetaMask before deleting instances.')

    const confirmed =
      typeof window === 'undefined'
        ? true
        : window.confirm(
            `Delete ${instanceName(instance)}?\n\nAleph will receive a FORGET message for ${instance.item_hash}. The row may remain visible as Removing for a short time afterward.`
          )

    if (!confirmed) return

    deletingInstanceHash = instance.item_hash
    instanceActionFeedback = {
      ...instanceActionFeedback,
      [instance.item_hash]: {
        tone: 'info',
        message: 'Submitting delete request to Aleph...'
      }
    }

    try {
      statusText = 'Signing delete request'
      const result = await deleteInstance({
        sender: wallet.address,
        instanceHash: instance.item_hash,
        reason: 'Deleted via Aleph Relay Deployer'
      })

      instances = await fetchInstances(wallet.address)
      balance = await fetchBalance(wallet.address)
      instanceDetailsRefreshNonce += 1

      statusText =
        result.status === 'rejected'
          ? 'Delete request rejected'
          : result.status === 'processed'
            ? 'Delete request processed'
            : 'Delete request submitted'
      instanceActionFeedback = {
        ...instanceActionFeedback,
        [instance.item_hash]: {
          tone: result.status === 'rejected' ? 'error' : 'info',
          message:
            result.status === 'rejected'
              ? 'Aleph rejected the delete request.'
              : result.status === 'processed'
              ? 'Delete request accepted. Aleph may keep this row visible as Removing for a short time.'
              : 'Delete request submitted. Aleph may take a moment to mark the instance as Removing.'
        }
      }
    } catch (error) {
      statusText = 'Needs attention'
      instanceActionFeedback = {
        ...instanceActionFeedback,
        [instance.item_hash]: {
          tone: 'error',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    } finally {
      deletingInstanceHash = ''
    }
  }
</script>

<svelte:head>
  <title>Aleph Relay Deployer</title>
</svelte:head>

<main class="app-shell">
  <section class="workspace">
    <aside class="status-rail" aria-label="Deployment status">
      <div class="brand-lockup">
        <img src="./relay-icon.svg" alt="" width="42" height="42" />
        <div>
          <h1>Aleph Relay Deployer</h1>
          <p>Browser-only VM deployment</p>
        </div>
      </div>

      <div class="status-list">
        <div class="status-item">
          <span class:ok={rootfsReady} class:pending={rootfsPending} class:error={rootfsRejected}></span>
          <div>
            <strong>Rootfs</strong>
            <small>{rootfsDisplayLabel}</small>
            {#if rootfsInstallStrategy}
              <small>{rootfsInstallStrategy} image</small>
            {/if}
            <small>{rootfsStatusLabel}</small>
          </div>
        </div>
        <div class="status-item">
          <span class:ok={Boolean(pricing)}></span>
          <div>
            <strong>Pricing</strong>
            <small>{pricingState.fetchedAt ? dateLabel(pricingState.fetchedAt / 1000) : 'not loaded'}</small>
          </div>
        </div>
        <div class="status-item">
          <span class:ok={Boolean(wallet)}></span>
          <div>
            <strong>Wallet</strong>
            <small>{wallet ? shortHash(wallet.address, 6, 4) : 'disconnected'}</small>
          </div>
        </div>
      </div>

      <div class="metric-stack">
        <div>
          <span>Available on Aleph</span>
          <strong>{balance ? formatNumber(Number(balance.balance) - Number(balance.locked_amount), 4) : '-'}</strong>
          {#if alephRecognizedBalance != null}
            <small>Recognized total: {formatNumber(alephRecognizedBalance, 4)} ALEPH</small>
          {/if}
          {#if alephLockedAmount != null}
            <small>Locked amount: {formatNumber(alephLockedAmount, 4)} ALEPH</small>
          {/if}
        </div>
        <div>
          <span>Credits</span>
          <strong>{balance ? formatNumber(balance.credit_balance, 0) : '-'}</strong>
        </div>
      </div>

      <div class="balance-panel">
        <strong>Aleph-recognized balances</strong>
        {#if recognizedChainBalances.length}
          <small>{recognizedChainBalances.join(' | ')}</small>
        {:else}
          <small>No supported-chain ALEPH balance reported yet.</small>
        {/if}
        <p>Holding does not require a lock transaction. Aleph only counts ALEPH it recognizes on supported chains.</p>
        <div class="balance-links">
          <a href={ALEPH_HOLDING_DOCS_URL} target="_blank" rel="noreferrer">How Holding Works</a>
          <a href={ALEPH_SUPPORTED_CHAINS_DOCS_URL} target="_blank" rel="noreferrer">Supported Chains</a>
        </div>
      </div>

      <button class="secondary-button" type="button" on:click={refresh} disabled={networkBusy} title="Refresh Aleph data">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.7-4.4L3 9m1-5v5h5M4 13a8 8 0 0 0 14.7 4.4L21 15m-1 5v-5h-5" /></svg>
        Refresh
      </button>
    </aside>

    <section class="deploy-tool" aria-label="Deploy relay VM">
      <div class="toolbar">
        <div>
          <h2>Deploy relay VM</h2>
          <p>{statusText}</p>
        </div>
        {#if wallet}
          <button class="secondary-button" type="button" on:click={connect} disabled={walletBusy || deployBusy} title="Reconnect wallet">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h14a2 2 0 0 1 2 2v8H6a2 2 0 0 1-2-2V7Zm14 4h3v4h-3a2 2 0 0 1 0-4Z" /></svg>
            {shortHash(wallet.address, 6, 4)}
          </button>
        {:else}
          <button class="primary-button" type="button" on:click={connect} disabled={walletBusy || deployBusy} title="Connect MetaMask">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h14a2 2 0 0 1 2 2v8H6a2 2 0 0 1-2-2V7Zm14 4h3v4h-3a2 2 0 0 1 0-4Z" /></svg>
            Connect
          </button>
        {/if}
      </div>

      {#if errorText}
        <div class="alert error" role="alert">{errorText}</div>
      {/if}

      {#if !usingBaseRootfs && rootfsState.errors.length}
        <div class="alert warning" role="status">{rootfsState.errors.join(' ')}</div>
      {:else if !usingBaseRootfs && !rootfsVerified}
        <div class="alert warning" role="status">Rootfs ItemHash is formatted but not verified on Aleph.</div>
      {/if}

      {#if rootfsBootstrapSummary}
        <div class="alert info" role="status">
          {rootfsBootstrapSummary}
          {#if rootfsBootstrapNetworkRequired}
            First boot requires outbound network access and may take longer before the service becomes healthy.
          {/if}
        </div>
      {/if}

      <div class="form-grid">
        <label>
          <span>Instance name</span>
          <input bind:value={form.name} maxlength="64" autocomplete="off" />
        </label>

        <label>
          <span>Tier</span>
          <select bind:value={form.tierId} on:change={selectDefaultCrn}>
            {#each availableTiers as option}
              <option value={option.id}>{tierLabel(option)}</option>
            {/each}
          </select>
        </label>

        <fieldset>
          <legend>Rootfs source</legend>
          <div class="segmented">
            {#each rootfsSourceModes as sourceMode}
              <button
                type="button"
                class:active={form.rootfsSourceMode === sourceMode}
                on:click={() => (form = { ...form, rootfsSourceMode: sourceMode })}
              >
                {sourceMode === 'base' ? 'Aleph base image' : 'Custom rootfs'}
              </button>
            {/each}
          </div>
        </fieldset>

        {#if usingBaseRootfs}
          <label>
            <span>Base image</span>
            <select bind:value={form.baseRootfs}>
              {#each ALEPH_BASE_ROOTFS_OPTIONS as option}
                <option value={option.id}>{option.label}</option>
              {/each}
            </select>
            <small>{selectedBaseRootfs.summary}</small>
          </label>
        {:else}
          <label>
            <span>Custom rootfs manifest</span>
            <input value={rootfsState.manifest?.version ?? 'Manifest missing'} readonly />
          </label>
        {/if}

        <fieldset>
          <legend>Payment</legend>
          <div class="segmented">
            <button
              type="button"
              class:active={form.paymentMode === 'hold'}
              on:click={() => setPaymentMode('hold')}
            >
              Hold
            </button>
            <button
              type="button"
              class:active={form.paymentMode === 'credit'}
              on:click={() => setPaymentMode('credit')}
            >
              Credit
            </button>
          </div>
        </fieldset>

        {#if form.paymentMode === 'hold'}
          <fieldset>
            <legend>Chain</legend>
            <div class="segmented chain-control">
              {#each paymentChains as chain}
                <button
                  type="button"
                  class:active={form.paymentChain === chain}
                  on:click={() => (form = { ...form, paymentChain: chain })}
                >
                  {chain}
                </button>
              {/each}
            </div>
          </fieldset>
        {:else}
          <label>
            <span>CRN</span>
            <select bind:value={form.selectedCrnHash}>
              <option value="">Select CRN</option>
              {#each crnOptions as crn}
                <option value={crn.hash}>{crnDisplayLabel(crn)}</option>
              {/each}
            </select>
          </label>
        {/if}

        <label class="wide">
          <span>SSH public key</span>
          <textarea bind:value={form.sshPublicKey} rows="4" spellcheck="false" placeholder="ssh-ed25519 ..."></textarea>
          <small>Saved in this browser for next time.</small>
        </label>
      </div>

      <div class="quote-strip">
        <div class:quote-ok={computeHoldShortfall === 0} class:quote-danger={computeHoldShortfall != null && computeHoldShortfall > 0}>
          <span>Required for deployment</span>
          <strong>
            {validation.quote ? `${formatNumber(validation.quote.required, 4)} ${validation.quote.label}` : '-'}
          </strong>
          {#if totalHoldRequirement != null}
            <small>Total with rootfs pinning: {formatNumber(totalHoldRequirement, 4)} ALEPH held</small>
          {/if}
          {#if computeHoldShortfall != null}
            <small class:status-ok={computeHoldShortfall === 0} class:status-danger={computeHoldShortfall > 0}>
              {computeHoldShortfall > 0
                ? `Short ${formatNumber(computeHoldShortfall, 4)} ALEPH for compute hold`
                : 'Compute hold covered by current wallet'}
            </small>
          {/if}
        </div>
        <div class:quote-ok={rootfsPinningShortfall === 0} class:quote-danger={rootfsPinningShortfall != null && rootfsPinningShortfall > 0}>
          <span>Rootfs pinning estimate</span>
          <strong>
            {usingBaseRootfs
              ? 'Not required'
              : rootfsStorageHolding != null
                ? `${formatNumber(rootfsStorageHolding, 4)} ALEPH held`
                : '-'}
          </strong>
          {#if usingBaseRootfs}
            <small>{selectedBaseRootfs.label} is managed by Aleph.</small>
          {:else if rootfsSourceSizeMiB != null}
            <small>{formatNumber(rootfsSourceSizeMiB, 2)} MiB uploaded image</small>
          {/if}
          {#if rootfsPinningShortfall != null}
            <small class:status-ok={rootfsPinningShortfall === 0} class:status-danger={rootfsPinningShortfall > 0}>
              {rootfsPinningShortfall > 0
                ? `Short ${formatNumber(rootfsPinningShortfall, 4)} ALEPH for rootfs pinning`
                : 'Rootfs pinning covered by current wallet'}
            </small>
          {/if}
        </div>
        <div>
          <span>Resources</span>
          <strong>
            {spec ? `${spec.vcpus} vCPU / ${formatNumber(spec.memoryMiB / 1024, 1)} GiB / ${formatNumber(spec.diskMiB / 1024, 0)} GiB` : '-'}
          </strong>
        </div>
        <div>
          <span>{form.paymentChain} wallet balance</span>
          <strong>
            {selectedChainWalletBalance != null ? `${formatNumber(selectedChainWalletBalance, 4)} ALEPH` : selectedChainWalletBalanceBusy ? 'Loading...' : '-'}
          </strong>
          {#if selectedChainRecognizedBalance != null}
            <small>Aleph recognizes {formatNumber(selectedChainRecognizedBalance, 4)} ALEPH on {form.paymentChain}</small>
          {/if}
          {#if selectedChainWalletBalance != null && selectedChainRecognizedBalance != null}
            <small>
              Difference: {formatNumber(Math.max(0, selectedChainWalletBalance - selectedChainRecognizedBalance), 4)} ALEPH
            </small>
          {/if}
          {#if selectedChainWalletBalanceError}
            <small class="status-danger">{selectedChainWalletBalanceError}</small>
          {/if}
        </div>
        <div>
          <span>Rootfs</span>
          <strong>{usingBaseRootfs ? selectedBaseRootfs.label : rootfsState.manifest ? shortHash(rootfsState.manifest.rootfsItemHash) : '-'}</strong>
        </div>
      </div>

      {#if totalHoldShortfall != null}
        <div class="hold-summary" class:hold-summary-danger={totalHoldShortfall > 0} class:hold-summary-ok={totalHoldShortfall === 0}>
          <strong>
            {totalHoldShortfall > 0
              ? `Current hold configuration is short by ${formatNumber(totalHoldShortfall, 4)} ALEPH.`
              : 'Current hold configuration is fully covered by the connected wallet.'}
          </strong>
          <span>
            Available: {availableAleph != null ? formatNumber(availableAleph, 4) : '-'} ALEPH.
            Required total: {formatNumber(totalHoldRequirement ?? 0, 4)} ALEPH.
          </span>
        </div>
      {/if}

      {#if usingBaseRootfs}
        <div class="rootfs-panel">
          <div>
            <span>Rootfs source</span>
            <strong>Aleph base image</strong>
          </div>
          <div>
            <span>Base image</span>
            <strong>{selectedBaseRootfs.label}</strong>
          </div>
          <div>
            <span>Availability</span>
            <strong>managed by Aleph</strong>
          </div>
          <div class="rootfs-links">
            <a href={ALEPH_INSTANCE_DOCS_URL} target="_blank" rel="noreferrer">Aleph instance docs</a>
          </div>
          <p class="rootfs-note">This deployment uses an Aleph-provided base image, so no custom rootfs pinning or STORE validation is required.</p>
        </div>
      {:else if rootfsResolution}
        <div class="rootfs-panel">
          <div>
            <span>Bootstrap setup</span>
            <strong>{rootfsInstallStrategy ?? 'unspecified'}</strong>
          </div>
          <div>
            <span>Aleph STORE status</span>
            <strong>{rootfsResolution.messageStatus}</strong>
          </div>
          <div>
            <span>Resolved CID</span>
            <strong>{rootfsResolution.cid ? shortHash(rootfsResolution.cid, 10, 8) : '-'}</strong>
          </div>
          <div>
            <span>Gateway probe</span>
            <strong>{rootfsResolution.gatewayStatus}</strong>
          </div>
          <div class="rootfs-links">
            <a href={apiMessageUrl(rootfsResolution.itemHash)} target="_blank" rel="noreferrer">STORE API</a>
            {#if rootfsResolution.gatewayUrl}
              <a href={rootfsResolution.gatewayUrl} target="_blank" rel="noreferrer">CID Gateway</a>
            {/if}
          </div>
          {#if rootfsResolution.gatewayError}
            <p class="rootfs-note">{rootfsResolution.gatewayError}</p>
          {/if}
          {#if rootfsBootstrapNetworkRequired}
            <p class="rootfs-note">This rootfs completes runtime setup on first boot and needs outbound network access.</p>
          {/if}
        </div>
      {/if}

      {#if validation.errors.length || validation.warnings.length}
        <div class="validation-list" aria-live="polite">
          {#each validation.errors as error}
            <p class="validation-error">{error}</p>
          {/each}
          {#each validation.warnings as warning}
            <p class="validation-warning">{warning}</p>
          {/each}
        </div>
      {/if}

      <div class="action-row">
        <button
          class="primary-button launch"
          class:caution={rootfsCautionDeploy}
          type="button"
          on:click={submitDeployment}
          disabled={deployBusy || walletBusy || !validation.ok || !wallet}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4 2 6 6 6 11l3 3-4 1-1 4-3-3c-5 0-9-2-11-6 4 0 7-2 7-7l3-3Zm0 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /></svg>
          {rootfsCautionDeploy ? 'Deploy With Caution' : 'Deploy'}
        </button>
      </div>

      {#if deploymentResult && wallet}
        <div class="result-panel" class:rejected-panel={deploymentResult.status === 'rejected'} class:pending-panel={deploymentResult.status === 'pending'}>
          <div>
            <span>Status</span>
            <strong>{deploymentResult.status}</strong>
          </div>
          <div>
            <span>Instance hash</span>
            <strong>{deploymentResult.itemHash}</strong>
          </div>
          {#if deploymentResult.rejectionReason}
            <p class="result-detail">{deploymentResult.rejectionReason}</p>
          {/if}
          {#if deploymentResult.errorCode != null}
            <p class="result-meta">Aleph error code: {deploymentResult.errorCode}</p>
          {/if}
          {#if deploymentResult.references?.length}
            <div class="result-references">
              <span>Referenced messages</span>
              <ul>
                {#each deploymentResult.references as reference}
                  <li>{reference.type ?? 'MESSAGE'} {shortHash(reference.itemHash)} - {reference.status}</li>
                {/each}
              </ul>
            </div>
          {/if}
          <nav>
            <a href={explorerUrl(wallet.address, deploymentResult.itemHash)} target="_blank" rel="noreferrer">Explorer</a>
            <a href={apiMessageUrl(deploymentResult.itemHash)} target="_blank" rel="noreferrer">API</a>
          </nav>
        </div>
      {/if}
    </section>
  </section>

  <section class="instances-band" aria-label="Instances">
    <div class="instances-header">
      <div>
        <h2>Instances</h2>
        <p>{instances.length ? `${instances.length} deployment${instances.length === 1 ? '' : 's'}` : 'No deployments loaded'}</p>
        {#if instanceDetailsBusy}
          <p>Loading confirmation and runtime details…</p>
        {:else if instanceDetailsError}
          <p>{instanceDetailsError}</p>
        {/if}
      </div>
      <button class="secondary-button" type="button" on:click={refreshInstancesOnly} disabled={networkBusy || !wallet} title="Refresh instances">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.7-4.4L3 9m1-5v5h5M4 13a8 8 0 0 0 14.7 4.4L21 15m-1 5v-5h-5" /></svg>
        Refresh
      </button>
    </div>

    <div class="instance-list">
      {#each instances as instance}
        <article class="instance-row">
          <div>
            <strong>{instanceName(instance)}</strong>
            <span>{shortHash(instance.item_hash)} · submitted {dateLabel(instance.time)}</span>
            {#if instanceConfirmedAt(instance)}
              <span>confirmed {dateLabel(instanceConfirmedAt(instance) ?? undefined)}</span>
            {/if}
            <div class="instance-tags">
              <span class="instance-tag">{instanceStatusLabel(instance)}</span>
              <span class="instance-tag">{runtimeStatusLabel(instance)}</span>
              {#if instanceCrnLabel(instance)}
                <span class="instance-tag">{instanceCrnLabel(instance)}</span>
              {/if}
            </div>
          </div>
          <div class="instance-actions">
            <span>{instance.content?.payment?.type ?? '-'}</span>
            <div class="instance-links">
              <a href={explorerUrl(instance.sender, instance.item_hash)} target="_blank" rel="noreferrer">Open</a>
              <button
                class="instance-delete-button"
                type="button"
                on:click={() => deleteDeployment(instance)}
                disabled={!canDeleteInstance(instance)}
                title="Delete this instance"
              >
                {deletingInstanceHash === instance.item_hash ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
          <div class="instance-details">
            {#if instanceIpv4(instance)}
              <div>
                <span>Host IPv4</span>
                <strong>{instanceIpv4(instance)}</strong>
              </div>
            {/if}
            {#if instanceIpv6(instance)}
              <div>
                <span>IPv6</span>
                <strong>{instanceIpv6(instance)}</strong>
              </div>
            {/if}
            {#if instanceDetails[instance.item_hash]?.execution?.networking?.ipv4_ip}
              <div>
                <span>VM IPv4</span>
                <strong>{instanceDetails[instance.item_hash].execution?.networking?.ipv4_ip}</strong>
              </div>
            {/if}
            {#if instanceDetails[instance.item_hash]?.execution?.status?.started_at}
              <div>
                <span>Started</span>
                <strong>{dateLabel(instanceDetails[instance.item_hash].execution?.status?.started_at ?? undefined)}</strong>
              </div>
            {/if}
            {#if instanceSshCommand(instance)}
              <div class="instance-detail-wide">
                <span>SSH</span>
                <strong>{instanceSshCommand(instance)}</strong>
              </div>
            {/if}
            {#if mappedPorts(instance).length}
              <div class="instance-detail-wide">
                <span>Mapped ports</span>
                <strong>{mappedPorts(instance).map(([port, mapping]) => `${port}→${mapping.host ?? '-'}${mapping.tcp ? ' TCP' : ''}${mapping.udp ? ' UDP' : ''}`).join(' · ')}</strong>
              </div>
            {/if}
            {#if runtimeDetailsNote(instance)}
              <div class="instance-detail-wide">
                <span>Runtime</span>
                <strong>{runtimeDetailsNote(instance)}</strong>
              </div>
            {/if}
            {#if instanceActionFeedback[instance.item_hash]}
              <div class="instance-detail-wide">
                <span>Delete</span>
                <strong
                  class:instance-feedback-info={instanceActionFeedback[instance.item_hash]?.tone === 'info'}
                  class:instance-feedback-error={instanceActionFeedback[instance.item_hash]?.tone === 'error'}
                >
                  {instanceActionFeedback[instance.item_hash]?.message}
                </strong>
              </div>
            {/if}
            {#if instanceDetails[instance.item_hash]?.error}
              <div class="instance-detail-wide">
                <span>Details</span>
                <strong>{instanceDetails[instance.item_hash].error}</strong>
              </div>
            {/if}
          </div>
        </article>
      {:else}
        <div class="empty-state">Connect a wallet to load deployments.</div>
      {/each}
    </div>
  </section>
</main>
