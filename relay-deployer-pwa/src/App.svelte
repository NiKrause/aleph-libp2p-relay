<script lang="ts">
  import { onMount } from 'svelte'
  import {
    configureOrbitdbRelaySetup,
    fetchBalance,
    fetchCrns,
    fetchInstanceRuntimeDetails,
    fetchInstances,
    notifyCrnAllocation,
    waitForDeploymentResult
  } from './lib/alephApi'
  import { deleteInstance } from './lib/alephForget'
  import { createDeploymentIntent, deployInstance } from './lib/alephMessage'
  import {
    DEFAULT_DEPLOYMENT_FORM,
    compatibleCrns,
    normalizeSshPublicKey,
    prepaidValidationErrors,
    quoteRequiredBudgetUnits,
    selectedTier,
    tierSpec,
    validateDeployment
  } from './lib/deployment'
  import { enrichCrnsWithGeo } from './lib/crnGeo'
  import { crnDisplayLabel, crnLocationLabel, crnScoreLabel, explorerUrl, apiMessageUrl, dateLabel, formatNumber, shortHash } from './lib/format'
  import {
    approvePrepaidBudget,
    consumeDeploymentReservation,
    depositPrepaidBudget,
    formatBudgetUnits,
    loadPrepaidVaultState,
    paymentChainFromChainId,
    prepaidVaultConfigured,
    refundExpiredReservation,
    reserveDeploymentBudget
  } from './lib/prepaid'
  import { fetchInstancePricing } from './lib/pricing'
  import { ensureInstancePortForwards, portForwardLabel } from './lib/portForwarding'
  import { loadRootfsManifest, resolveRootfsReference, verifyRootfsExists } from './lib/rootfsManifest'
  import { assessAAWallet, connectWallet, type WalletState } from './lib/wallet'
  import {
    ALEPH_BASE_ROOTFS_OPTIONS,
    ALEPH_INSTANCE_DOCS_URL,
    ALEPH_PERMISSIONS_DOCS_URL,
    PREPAID_VAULT_ADDRESS
  } from './lib/config'
  import type {
    AAWalletAssessment,
    BalanceResponse,
    Crn,
    DeploymentForm,
    DeploymentIntentEnvelope,
    DeploymentResult,
    InstanceMessage,
    InstanceRuntimeDetails,
    PricingState,
    PrepaidVaultState,
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
  let currentIntentEnvelope: DeploymentIntentEnvelope | null = null
  let aaWalletAssessment: AAWalletAssessment | null = null
  let prepaidState: PrepaidVaultState = {
    configured: false,
    chain: null,
    tokenAddress: null,
    vaultAddress: PREPAID_VAULT_ADDRESS || null,
    ownerAddress: null,
    totalDeposited: 0n,
    availableBalance: 0n,
    reservedBalance: 0n,
    currentReservation: null,
    enforcementLevel: 'none',
    aaWallet: null,
    warnings: []
  }
  let prepaidBusy = false
  let prepaidRequestKey = ''
  let deletingInstanceHash = ''
  let startingInstanceHash = ''
  let instanceActionFeedback: Record<string, { tone: 'info' | 'error'; message: string }> = {}
  let instanceSetupInFlight: Record<string, boolean> = {}
  let instanceSetupApplied: Record<string, string> = {}
  let instanceSetupAttempted: Record<string, string> = {}
  let instanceSetupPendingReachability: Record<string, string> = {}
  let instanceSshCopied: Record<string, boolean> = {}
  let crnGeoLookupInFlight: Record<string, boolean> = {}
  let networkBusy = false
  let walletBusy = false
  let deployBusy = false
  let statusText = 'Ready'
  let errorText = ''
  let sshPublicKeyStorageReady = false
  const rootfsSourceModes: DeploymentForm['rootfsSourceMode'][] = ['base', 'custom']
  const SSH_PUBLIC_KEY_STORAGE_KEY = 'aleph-relay-deployer:ssh-public-key'
  const ALEPH_SCHEDULER_ALLOCATION_BASE_URL = 'https://scheduler.api.aleph.cloud/api/v0/allocation'

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
  $: rootfsCreatedAtLabel = !usingBaseRootfs && rootfsState.manifest?.createdAt
    ? dateLabel(rootfsState.manifest.createdAt)
    : null
  $: rootfsPublishedAtLabel = !usingBaseRootfs && rootfsResolution?.receptionTime
    ? dateLabel(rootfsResolution.receptionTime)
    : null
  $: rootfsSummaryIssueLabel = rootfsRejected
    ? rootfsResolution?.rejectionReason ?? 'Rejected by Aleph.'
    : null
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
  $: recognizedChainBalances = balance?.details
    ? Object.entries(balance.details)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([chain, amount]) => `${chain}: ${formatNumber(Number(amount), 4)}`)
    : []
  $: baseValidation = validateDeployment({
    form,
    manifest: rootfsState.manifest,
    rootfsResolution,
    pricingState,
    balance,
    crns,
    rootfsVerified
  })
  $: prepaidErrors = prepaidValidationErrors({
    aaWallet: aaWalletAssessment,
    quote: baseValidation.quote,
    availableBalance: prepaidState.availableBalance,
    currentReservationAmount: prepaidState.currentReservation?.reservedAmount ?? 0n,
    reservationExpired: prepaidState.currentReservation?.expired ?? false,
    prepaidConfigured: prepaidState.configured
  })
  $: validation = {
    ...baseValidation,
    errors: [...baseValidation.errors, ...prepaidErrors],
    ok: baseValidation.ok && prepaidErrors.length === 0
  }
  $: availableTiers = pricing?.tiers ?? []
  $: selectedCrnOption = form.selectedCrnHash ? crns.find((crn) => crn.hash === form.selectedCrnHash) ?? null : null
  $: prepaidConfigured = prepaidVaultConfigured()
  $: prepaidRequiredBudget = quoteRequiredBudgetUnits(baseValidation.quote)
  $: prepaidAvailableDisplay = formatBudgetUnits(prepaidState.availableBalance)
  $: prepaidReservedDisplay = formatBudgetUnits(prepaidState.reservedBalance)
  $: prepaidTotalDisplay = formatBudgetUnits(prepaidState.totalDeposited)
  $: connectedPaymentChain = paymentChainFromChainId(wallet?.chainId ?? null)
  $: if (sshPublicKeyStorageReady) persistSshPublicKey(form.sshPublicKey)
  $: if (
    selectedCrnOption &&
    !crnLocationLabel(selectedCrnOption) &&
    !selectedCrnOption.geo_source &&
    !selectedCrnOption.resolved_ip &&
    !crnGeoLookupInFlight[selectedCrnOption.hash]
  ) {
    void enrichSelectedCrn(selectedCrnOption)
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
  $: {
    const currentWallet = wallet
    const requestKey =
      currentWallet && pricing && tier
        ? [
            currentWallet.address,
            currentWallet.chainId ?? '',
            form.name,
            form.rootfsSourceMode,
            form.baseRootfs,
            form.tierId,
            form.selectedCrnHash,
            normalizeSshPublicKey(form.sshPublicKey),
            rootfsState.manifest?.rootfsItemHash ?? ''
          ].join(':')
        : ''

    if (!currentWallet || !pricing || !tier) {
      prepaidRequestKey = ''
      aaWalletAssessment = null
      currentIntentEnvelope = null
      prepaidState = {
        configured: false,
        chain: null,
        tokenAddress: null,
        vaultAddress: PREPAID_VAULT_ADDRESS || null,
        ownerAddress: null,
        totalDeposited: 0n,
        availableBalance: 0n,
        reservedBalance: 0n,
        currentReservation: null,
        enforcementLevel: 'none',
        aaWallet: null,
        warnings: []
      }
    } else if (requestKey && requestKey !== prepaidRequestKey) {
      prepaidRequestKey = requestKey
      void refreshPrepaidContext(requestKey)
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
      applyInitialRootfsSourceModePreference()

      if (pricingResult.status === 'fulfilled') {
        pricingState = pricingResult.value
      } else {
        loadErrors.push(`Pricing: ${pricingResult.reason instanceof Error ? pricingResult.reason.message : String(pricingResult.reason)}`)
      }

      if (crnResult.status === 'fulfilled') {
        crns = crnResult.value
        void enrichCurrentCrns(crnResult.value)
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

      ensureValidRootfsSourceMode()
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

  function preferredRootfsSourceMode(state: RootfsManifestState): DeploymentForm['rootfsSourceMode'] {
    return state.valid && state.manifest ? 'custom' : 'base'
  }

  function applyInitialRootfsSourceModePreference() {
    form = {
      ...form,
      rootfsSourceMode: preferredRootfsSourceMode(rootfsState)
    }
  }

  function ensureValidRootfsSourceMode() {
    if (form.rootfsSourceMode === 'custom' && !(rootfsState.valid && rootfsState.manifest)) {
      form = {
        ...form,
        rootfsSourceMode: 'base'
      }
    }
  }

  async function enrichCurrentCrns(nextCrns: Crn[]) {
    const requestKey = nextCrns.map((crn) => crn.hash).join(',')
    const enriched = await enrichCrnsWithGeo(nextCrns)

    if (crns.map((crn) => crn.hash).join(',') === requestKey) {
      crns = enriched
      selectDefaultCrn()
    }
  }

  async function enrichSelectedCrn(crn: Crn) {
    crnGeoLookupInFlight = {
      ...crnGeoLookupInFlight,
      [crn.hash]: true
    }

    try {
      const [enriched] = await enrichCrnsWithGeo([crn])
      crns = crns.map((item) => (item.hash === crn.hash ? enriched : item))
    } finally {
      crnGeoLookupInFlight = {
        ...crnGeoLookupInFlight,
        [crn.hash]: false
      }
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
        void enrichCurrentCrns(crnResult.value)
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

      ensureValidRootfsSourceMode()
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
        void autoConfigureOrbitdbRelayInstances(address, nextInstances, details)
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

  async function refreshPrepaidContext(requestKey: string) {
    if (!wallet || !pricing || !tier) return

    prepaidBusy = true
    try {
      const normalizedSshPublicKey = normalizeSshPublicKey(form.sshPublicKey)
      const selectedCrn = form.selectedCrnHash ? crns.find((crn) => crn.hash === form.selectedCrnHash) ?? null : null
      const assessment = await assessAAWallet(wallet.address)
      const intentEnvelope = await createDeploymentIntent({
        sender: wallet.address,
        form: { ...form, sshPublicKey: normalizedSshPublicKey },
        manifest: usingBaseRootfs ? null : rootfsState.manifest,
        pricing,
        tier,
        selectedCrn,
        quoteRequiredBudget: quoteRequiredBudgetUnits(baseValidation.quote)
      })
      const nextPrepaidState = await loadPrepaidVaultState({
        ownerAddress: wallet.address,
        currentIntentHash: intentEnvelope.intentHash,
        aaWallet: assessment
      })

      if (prepaidRequestKey === requestKey && wallet?.address === assessment.ownerAddress) {
        aaWalletAssessment = assessment
        currentIntentEnvelope = intentEnvelope
        prepaidState = nextPrepaidState
      }
    } catch (error) {
      if (prepaidRequestKey === requestKey) {
        aaWalletAssessment = null
        currentIntentEnvelope = null
        prepaidState = {
          configured: prepaidConfigured,
          chain: connectedPaymentChain,
          tokenAddress: null,
          vaultAddress: PREPAID_VAULT_ADDRESS || null,
          ownerAddress: wallet.address,
          totalDeposited: 0n,
          availableBalance: 0n,
          reservedBalance: 0n,
          currentReservation: null,
          enforcementLevel: 'none',
          aaWallet: null,
          warnings: [error instanceof Error ? error.message : String(error)]
        }
      }
    } finally {
      if (prepaidRequestKey === requestKey) prepaidBusy = false
    }
  }

  async function refreshPrepaidStateOnly() {
    if (!prepaidRequestKey) return
    await refreshPrepaidContext(prepaidRequestKey)
  }

  async function approveCurrentPrepaidBudget() {
    await runTask('Approving prepaid budget', async () => {
      if (!wallet) throw new Error('Connect MetaMask before approving prepaid budget.')
      if (!connectedPaymentChain) throw new Error('Switch to ETH, BASE, or AVAX before approving prepaid budget.')
      if (!prepaidRequiredBudget) throw new Error('A live deployment quote is required before approving prepaid budget.')

      statusText = 'Waiting for wallet approval'
      await approvePrepaidBudget({
        ownerAddress: wallet.address,
        amount: prepaidRequiredBudget,
        chain: connectedPaymentChain
      })
      await refreshPrepaidStateOnly()
      statusText = 'Prepaid approval submitted'
    }, 'deploy')
  }

  async function depositCurrentPrepaidBudget() {
    await runTask('Depositing prepaid budget', async () => {
      if (!wallet) throw new Error('Connect MetaMask before depositing prepaid budget.')
      if (!prepaidRequiredBudget) throw new Error('A live deployment quote is required before depositing prepaid budget.')

      statusText = 'Waiting for wallet confirmation'
      await depositPrepaidBudget({
        ownerAddress: wallet.address,
        amount: prepaidRequiredBudget
      })
      await refreshPrepaidStateOnly()
      statusText = 'Prepaid deposit submitted'
    }, 'deploy')
  }

  async function reserveCurrentDeploymentIntent() {
    await runTask('Reserving prepaid budget', async () => {
      if (!wallet) throw new Error('Connect MetaMask before reserving prepaid budget.')
      if (!currentIntentEnvelope) throw new Error('Deployment intent is not ready yet.')
      if (!prepaidRequiredBudget) throw new Error('A live deployment quote is required before reserving prepaid budget.')

      statusText = 'Waiting for wallet confirmation'
      await reserveDeploymentBudget({
        ownerAddress: wallet.address,
        intentHash: currentIntentEnvelope.intentHash,
        amount: prepaidRequiredBudget,
        expiresAt: currentIntentEnvelope.intent.expiresAt
      })
      await refreshPrepaidStateOnly()
      statusText = 'Prepaid reservation submitted'
    }, 'deploy')
  }

  async function refundCurrentReservation() {
    await runTask('Refunding expired reservation', async () => {
      if (!wallet) throw new Error('Connect MetaMask before refunding reservations.')
      if (!currentIntentEnvelope) throw new Error('Deployment intent is not ready yet.')

      statusText = 'Waiting for wallet confirmation'
      await refundExpiredReservation({
        ownerAddress: wallet.address,
        intentHash: currentIntentEnvelope.intentHash
      })
      await refreshPrepaidStateOnly()
      statusText = 'Expired reservation refunded'
    }, 'deploy')
  }

  async function submitDeployment() {
    await runTask('Preparing deployment', async () => {
      if (!wallet) throw new Error('Connect MetaMask before deployment.')
      if (!pricing || !tier || (!usingBaseRootfs && !rootfsState.manifest)) throw new Error('Network data is incomplete.')
      if (!validation.ok) throw new Error(validation.errors.join(' '))
      if (!currentIntentEnvelope) throw new Error('Deployment intent is not ready yet.')

      const selectedCrn = form.selectedCrnHash
        ? crns.find((crn) => crn.hash === form.selectedCrnHash) ?? null
        : null
      const normalizedSshPublicKey = normalizeSshPublicKey(form.sshPublicKey)
      if (normalizedSshPublicKey !== form.sshPublicKey) {
        form = { ...form, sshPublicKey: normalizedSshPublicKey }
      }

      statusText = 'Signing Aleph message'
      deploymentResult = await deployInstance({
        sender: wallet.address,
        form: { ...form, sshPublicKey: normalizedSshPublicKey },
        manifest: usingBaseRootfs ? null : rootfsState.manifest,
        pricing,
        tier,
        selectedCrn,
        now: currentIntentEnvelope.intent.messageTime
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

      const feedbackMessages: string[] = []
      let feedbackTone: 'info' | 'error' = 'info'

      if (deploymentResult.status === 'processed') {
        try {
          statusText = 'Configuring port forwards'
          const portForwardResult = await ensureInstancePortForwards({
            sender: wallet.address,
            instanceItemHash: deploymentResult.itemHash,
            manifest: usingBaseRootfs ? null : rootfsState.manifest
          })
          const requestedPorts = portForwardResult.requestedPorts.map(portForwardLabel).join(', ')
          feedbackMessages.push(
            portForwardResult.aggregateStatus === 'pending'
              ? `Port forwards submitted: ${requestedPorts}.`
              : `Port forwards configured: ${requestedPorts}.`
          )
        } catch (error) {
          feedbackTone = 'error'
          feedbackMessages.push(`Port forward setup failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (deploymentResult.status === 'processed' && selectedCrn?.address) {
        try {
          const feedbackMessage = await requestCrnStart(deploymentResult.itemHash, selectedCrn.address)
          feedbackMessages.push(feedbackMessage)
        } catch (error) {
          feedbackTone = 'error'
          feedbackMessages.push(error instanceof Error ? error.message : String(error))
        }
      }

      if (deploymentResult.status === 'processed' && prepaidState.configured) {
        try {
          statusText = 'Consuming prepaid reservation'
          await consumeDeploymentReservation({
            ownerAddress: wallet.address,
            intentHash: currentIntentEnvelope.intentHash,
            amount: prepaidRequiredBudget
          })
          feedbackMessages.push(`Prepaid reservation consumed for ${formatNumber(formatBudgetUnits(prepaidRequiredBudget), 4)} budget units.`)
        } catch (error) {
          feedbackTone = 'error'
          feedbackMessages.push(`Prepaid reservation consume failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (deploymentResult.status === 'processed' && feedbackMessages.length > 0) {
        instanceActionFeedback = {
          ...instanceActionFeedback,
          [deploymentResult.itemHash]: {
            tone: feedbackTone,
            message: feedbackMessages.join(' ')
          }
        }
      }

      instances = await fetchInstances(wallet.address)
      balance = await fetchBalance(wallet.address)
      instanceDetailsRefreshNonce += 1
      await refreshPrepaidStateOnly()

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

  type InstanceStageTone = 'ok' | 'pending' | 'muted' | 'error'

  interface InstanceStageSummary {
    label: string
    tone: InstanceStageTone
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
      if (details?.executionLookupBlocked && details.allocation?.crnUrl) return 'Runtime hidden by CRN CORS'
      if (details?.allocation?.source === 'scheduler' && details.allocation.crnUrl) return 'Allocated, waiting for runtime'
      if (details?.allocation?.source === 'manual' && details.allocation.crnUrl) return 'Selected CRN resolved'
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

  function instanceMessageStage(instance: InstanceMessage): InstanceStageSummary {
    const status = (instanceDetails[instance.item_hash]?.messageStatus ?? instance.status ?? '').toLowerCase()

    if (status === 'processed') return { label: 'Processed on Aleph', tone: 'ok' }
    if (status === 'pending') return { label: 'Pending confirmation', tone: 'pending' }
    if (status === 'rejected') return { label: 'Rejected by Aleph', tone: 'error' }
    if (status === 'removing') return { label: 'Delete requested', tone: 'pending' }
    return { label: 'Message status unavailable', tone: 'muted' }
  }

  function instanceAllocationStage(instance: InstanceMessage): InstanceStageSummary {
    const details = instanceDetails[instance.item_hash]

    if (details?.execution) return { label: 'Execution listed on CRN', tone: 'ok' }
    if (details?.allocation?.source === 'scheduler' && details.allocation.crnUrl) {
      return { label: 'Allocated by scheduler', tone: 'ok' }
    }
    if (details?.allocation?.source === 'manual' && details.allocation.crnUrl) {
      return { label: 'Selected CRN resolved', tone: 'ok' }
    }
    if (details?.messageStatus === 'processed') return { label: 'Allocation not reported yet', tone: 'pending' }
    return { label: 'Waiting for Aleph processing', tone: 'muted' }
  }

  function instanceRuntimeStage(instance: InstanceMessage): InstanceStageSummary {
    const details = instanceDetails[instance.item_hash]
    const execution = details?.execution
    const status = execution?.status

    if (status?.stopped_at) return { label: 'Stopped', tone: 'muted' }
    if (status?.stopping_at) return { label: 'Stopping', tone: 'pending' }
    if (status?.started_at || execution?.running) return { label: 'Running', tone: 'ok' }
    if (status?.starting_at) return { label: 'Starting', tone: 'pending' }
    if (status?.prepared_at) return { label: 'Prepared', tone: 'pending' }
    if (status?.preparing_at || status?.defined_at) return { label: 'Preparing', tone: 'pending' }
    if (details?.executionLookupBlocked && details.allocation?.crnUrl) {
      return { label: 'Runtime blocked by CRN CORS', tone: 'pending' }
    }
    if (details?.allocation?.source === 'scheduler' && details.allocation.crnUrl) {
      return { label: 'Allocated, awaiting CRN details', tone: 'pending' }
    }
    if (details?.allocation?.source === 'manual' && details.allocation.crnUrl) {
      return { label: 'Awaiting CRN runtime details', tone: 'pending' }
    }
    if (details?.messageStatus === 'processed') return { label: 'Runtime not available yet', tone: 'pending' }
    return { label: 'Runtime not available', tone: 'muted' }
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

  function instanceWebAccessProxyUrl(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    return details?.execution?.networking?.proxy_url ?? details?.webAccessUrl ?? null
  }

  function instanceSchedulerUrl(instance: InstanceMessage) {
    return `${ALEPH_SCHEDULER_ALLOCATION_BASE_URL}/${instance.item_hash}`
  }

  function instanceCrnExecutionListUrl(instance: InstanceMessage) {
    const crnUrl = instanceDetails[instance.item_hash]?.allocation?.crnUrl
    return crnUrl ? `${crnUrl.replace(/\/+$/, '')}/v2/about/executions/list` : null
  }

  function instanceRequestedNodeHash(instance: InstanceMessage) {
    return instance.content?.requirements?.node?.node_hash ?? null
  }

  function instanceAllocationSourceLabel(instance: InstanceMessage) {
    const source = instanceDetails[instance.item_hash]?.allocation?.source
    if (source === 'scheduler') return 'scheduler'
    if (source === 'manual') return 'deploy message (credit)'
    return null
  }

  function showSchedulerAllocationLink(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    return details?.allocation?.source === 'scheduler'
  }

  function instanceSshCommand(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    const networking = details?.execution?.networking
    const sshPort = networking?.mapped_ports?.['22']?.host
    const hostIpv4 = networking?.host_ipv4
    const ipv6 = networking?.ipv6_ip || networking?.ipv6 || details?.allocation?.vmIpv6

    if (hostIpv4 && sshPort) return `ssh root@${hostIpv4} -p ${sshPort}`
    if (ipv6) return `ssh root@${ipv6}`
    return null
  }

  async function copyInstanceSshCommand(instance: InstanceMessage) {
    const command = instanceSshCommand(instance)
    if (!command || !navigator?.clipboard?.writeText) return

    await navigator.clipboard.writeText(command)
    instanceSshCopied = {
      ...instanceSshCopied,
      [instance.item_hash]: true
    }

    window.setTimeout(() => {
      instanceSshCopied = {
        ...instanceSshCopied,
        [instance.item_hash]: false
      }
    }, 1600)
  }

  function mappedPorts(instance: InstanceMessage) {
    return Object.entries(instanceDetails[instance.item_hash]?.execution?.networking?.mapped_ports ?? {})
  }

  function orbitdbSetupTarget(instance: InstanceMessage) {
    const profile = rootfsState.manifest?.profile
    if (profile !== 'orbitdb-relay-pinner' && profile !== 'uc-rust-peer' && profile !== 'uc-go-peer') return null
    if (instance.content?.rootfs?.parent?.ref !== rootfsState.manifest.rootfsItemHash) return null
    const details = instanceDetails[instance.item_hash]
    const networking = details?.execution?.networking
    const hostIpv4 = networking?.host_ipv4
    const publicIpv6 = networking?.ipv6_ip || networking?.ipv6 || details?.allocation?.vmIpv6 || null
    const setupPort = networking?.mapped_ports?.['80']?.host
    const proxyUrl = instanceWebAccessProxyUrl(instance)
    if (!hostIpv4 || !setupPort) return null

    if (profile === 'orbitdb-relay-pinner') {
      const metricsPort = networking?.mapped_ports?.['9090']?.host ?? null
      const metricsHttpsPort = networking?.mapped_ports?.['9443']?.host ?? null
      const tcpPort = networking?.mapped_ports?.['9091']?.host
      const wsPort = networking?.mapped_ports?.['443']?.host ?? networking?.mapped_ports?.['9092']?.host

      if (!tcpPort || !wsPort) return null

      return {
        profile,
        serviceName: 'orbitdb-relay-pinner',
        hostIpv4,
        publicIpv6,
        setupPort,
        tcpPort,
        wsPort,
        proxyUrl,
        metricsPort,
        metricsHttpsPort,
        webrtcPort: networking?.mapped_ports?.['9093']?.host ?? null,
        quicPort: networking?.mapped_ports?.['9094']?.host ?? null
      }
    }

    if (profile === 'uc-go-peer') {
      const relayPort = networking?.mapped_ports?.['9095']?.host
      if (!relayPort) return null

      return {
        profile,
        serviceName: 'uc-go-peer',
        hostIpv4,
        publicIpv6,
        setupPort,
        tcpPort: relayPort,
        wsPort: relayPort,
        proxyUrl: null,
        metricsPort: null,
        metricsHttpsPort: null,
        webrtcPort: relayPort,
        quicPort: relayPort
      }
    }

    const tcpPort = networking?.mapped_ports?.['9092']?.host
    const wsPort = networking?.mapped_ports?.['443']?.host ?? networking?.mapped_ports?.['9093']?.host
    if (!tcpPort || !wsPort) return null

    return {
      profile,
      serviceName: 'uc-rust-peer',
      hostIpv4,
      publicIpv6,
      setupPort,
      tcpPort,
      wsPort,
      proxyUrl,
      metricsPort: null,
      metricsHttpsPort: null,
      webrtcPort: networking?.mapped_ports?.['9090']?.host ?? null,
      quicPort: networking?.mapped_ports?.['9091']?.host ?? null
    }
  }

  function orbitdbSetupKey(instance: InstanceMessage) {
    const target = orbitdbSetupTarget(instance)
    if (!target) return null

    return [
      target.hostIpv4,
      target.publicIpv6 ?? '',
      target.setupPort,
      target.tcpPort,
      target.wsPort,
      target.proxyUrl ?? '',
      target.metricsPort ?? '',
      target.metricsHttpsPort ?? '',
      target.webrtcPort ?? '',
      target.quicPort ?? ''
    ].join(':')
  }

  function canRetryOrbitdbSetup(instance: InstanceMessage) {
    const setupKey = orbitdbSetupKey(instance)
    if (!setupKey) return false
    if (instanceSetupInFlight[instance.item_hash]) return false
    return instanceSetupApplied[instance.item_hash] !== setupKey
  }

  function orbitdbSetupReachabilityNote(instance: InstanceMessage) {
    const setupKey = orbitdbSetupKey(instance)
    if (!setupKey) return null
    if (instanceSetupPendingReachability[instance.item_hash] !== setupKey) return null

    const target = orbitdbSetupTarget(instance)
    if (!target) return null

    return `Aleph has already published the mapped setup port ${target.hostIpv4}:${target.setupPort}, but that external CRN port-forward is not confirming reachability yet. The VM-side setup server can still be listening on internal port 80 for ${target.serviceName}.`
  }

  async function configureOrbitdbRelayInstance(
    instance: InstanceMessage,
    source: 'auto' | 'manual' = 'manual'
  ) {
    const target = orbitdbSetupTarget(instance)
    const setupKey = orbitdbSetupKey(instance)
    if (!target || !setupKey) throw new Error('Runtime port mappings are not available yet for this instance.')

    instanceSetupInFlight = {
      ...instanceSetupInFlight,
      [instance.item_hash]: true
    }
    instanceActionFeedback = {
      ...instanceActionFeedback,
      [instance.item_hash]: {
          tone: 'info',
          message:
            source === 'manual'
            ? `Retrying ${target.serviceName} setup with the current mapped Aleph ports...`
            : `Configuring ${target.serviceName} setup endpoint with mapped Aleph ports...`
      }
    }

    try {
      const result = await configureOrbitdbRelaySetup(target)

      instanceSetupAttempted = {
        ...instanceSetupAttempted,
        [instance.item_hash]: setupKey
      }

      if (result.status === 'configured') {
        instanceSetupPendingReachability = {
          ...instanceSetupPendingReachability,
          [instance.item_hash]: ''
        }
        instanceSetupApplied = {
          ...instanceSetupApplied,
          [instance.item_hash]: setupKey
        }
        instanceActionFeedback = {
          ...instanceActionFeedback,
          [instance.item_hash]: {
            tone: 'info',
            message: `Relay setup endpoint accepted the mapped ports and started ${target.serviceName}.`
          }
        }
      } else {
        instanceSetupPendingReachability = {
          ...instanceSetupPendingReachability,
          [instance.item_hash]: setupKey
        }
        instanceActionFeedback = {
          ...instanceActionFeedback,
          [instance.item_hash]: {
            tone: 'info',
            message:
              `Relay setup request was sent to ${target.hostIpv4}:${target.setupPort}, but the browser could not confirm the response. Aleph already published that mapped host port, while the CRN may still be activating reachability for it. Refresh or retry setup in a minute to verify whether the VM accepted the mapped ports.`
          }
        }
      }

      window.setTimeout(() => {
        instanceDetailsRefreshNonce += 1
      }, 4000)
    } catch (error) {
      instanceSetupPendingReachability = {
        ...instanceSetupPendingReachability,
        [instance.item_hash]: ''
      }
      instanceSetupAttempted = {
        ...instanceSetupAttempted,
        [instance.item_hash]: setupKey
      }
      instanceActionFeedback = {
        ...instanceActionFeedback,
        [instance.item_hash]: {
          tone: 'error',
          message: error instanceof Error ? error.message : String(error)
        }
      }
    } finally {
      instanceSetupInFlight = {
        ...instanceSetupInFlight,
        [instance.item_hash]: false
      }
    }
  }

  async function autoConfigureOrbitdbRelayInstances(
    address: string,
    nextInstances: InstanceMessage[],
    details: Record<string, InstanceRuntimeDetails>
  ) {
    for (const instance of nextInstances) {
      if (instance.sender !== address) continue
      const status = (details[instance.item_hash]?.messageStatus ?? instance.status ?? '').toLowerCase()
      if (status !== 'processed') continue

      const setupKey = orbitdbSetupKey(instance)
      if (!setupKey) continue
      if (instanceSetupApplied[instance.item_hash] === setupKey) continue
      if (instanceSetupAttempted[instance.item_hash] === setupKey) continue
      if (instanceSetupInFlight[instance.item_hash]) continue

      try {
        await configureOrbitdbRelayInstance(instance, 'auto')
      } catch (error) {
        instanceActionFeedback = {
          ...instanceActionFeedback,
          [instance.item_hash]: {
            tone: 'error',
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }
    }
  }

  async function retryOrbitdbRelaySetup(instance: InstanceMessage) {
    const setupKey = orbitdbSetupKey(instance)
    if (!setupKey) throw new Error('Runtime port mappings are not available yet for this instance.')

    instanceSetupAttempted = {
      ...instanceSetupAttempted,
      [instance.item_hash]: ''
    }

    await configureOrbitdbRelayInstance(instance, 'manual')
  }

  function runtimeDetailsNote(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]
    const crnLabel = instanceCrnLabel(instance)

    if (details?.execution) return null
    if (details?.executionLookupBlocked && details?.allocation?.crnUrl && crnLabel) {
      return `${crnLabel} exposes runtime details, but the browser cannot read them because that CRN does not send CORS headers. Open the CRN executions link or the Aleph console to inspect connection details.`
    }
    if (details?.allocation?.source === 'scheduler' && details.allocation.crnUrl && crnLabel) {
      return `${crnLabel} has been selected, but it is not exposing this VM in its execution list yet.`
    }
    if (details?.allocation?.source === 'manual' && details.allocation.crnUrl && crnLabel) {
      return `${crnLabel} is selected in the deployment. Runtime details will appear here as soon as the browser can read that CRN's execution list.`
    }
    if (details?.messageStatus === 'processed') {
      return 'This deployment is confirmed on Aleph, but runtime allocation details are not available yet.'
    }
    return null
  }

  function canDeleteInstance(instance: InstanceMessage) {
    const status = (instanceDetails[instance.item_hash]?.messageStatus ?? instance.status ?? '').toLowerCase()
    return Boolean(wallet) && !deletingInstanceHash && status !== 'removing'
  }

  function canStartInstance(instance: InstanceMessage) {
    const details = instanceDetails[instance.item_hash]

    return Boolean(
      wallet &&
        !startingInstanceHash &&
        instance.content?.payment?.type === 'credit' &&
        details?.messageStatus === 'processed' &&
        details.allocation?.source === 'manual' &&
        details.allocation.crnUrl &&
        !details.execution
    )
  }

  async function requestCrnStart(itemHash: string, crnUrl: string): Promise<string> {
    const result = await notifyCrnAllocation(crnUrl, itemHash)

    if (result.status === 'confirmed') {
      return 'CRN accepted the start request. Runtime details may take a moment to appear.'
    }

    return 'Start request was sent, but the browser could not confirm the CRN response because of cross-origin restrictions. Refresh to see whether the VM appears.'
  }

  async function startDeployment(instance: InstanceMessage) {
    if (!wallet) throw new Error('Connect MetaMask before starting instances.')

    const details = instanceDetails[instance.item_hash]
    const crnUrl = details?.allocation?.crnUrl
    if (!crnUrl) throw new Error('No CRN URL is available for this instance.')

    startingInstanceHash = instance.item_hash
    instanceActionFeedback = {
      ...instanceActionFeedback,
      [instance.item_hash]: {
        tone: 'info',
        message: 'Requesting the selected CRN to start this instance...'
      }
    }

    try {
      const feedbackMessage = await requestCrnStart(instance.item_hash, crnUrl)
      statusText = 'CRN start requested'
      instanceActionFeedback = {
        ...instanceActionFeedback,
        [instance.item_hash]: {
          tone: 'info',
          message: feedbackMessage
        }
      }

      instances = await fetchInstances(wallet.address)
      instanceDetailsRefreshNonce += 1
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
      startingInstanceHash = ''
    }
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
            {#if rootfsSummaryIssueLabel}
              <small class="summary-error">{rootfsSummaryIssueLabel}</small>
            {/if}
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
        <p>Deployments are credit-only right now. The connected wallet balance and Aleph credit balance are shown here for quick sanity checks.</p>
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

        <label>
          <span>CRN</span>
          <select bind:value={form.selectedCrnHash}>
            <option value="">Select CRN</option>
            {#each crnOptions as crn}
              <option value={crn.hash}>{crnDisplayLabel(crn)}</option>
            {/each}
          </select>
          {#if selectedCrnOption}
            <small>
              {crnScoreLabel(selectedCrnOption) ? `Score ${crnScoreLabel(selectedCrnOption)} · ` : ''}
              {selectedCrnOption.resolved_ip ? `${selectedCrnOption.resolved_ip} · ` : ''}
              {crnLocationLabel(selectedCrnOption) ??
                (crnGeoLookupInFlight[selectedCrnOption.hash] ? 'Looking up location...' : 'Location pending lookup')}
            </small>
          {/if}
        </label>

        <label class="wide">
          <span>SSH public key</span>
          <textarea
            bind:value={form.sshPublicKey}
            rows="4"
            spellcheck="false"
            placeholder="ssh-ed25519 AAAA... user@host"
            on:blur={() => (form = { ...form, sshPublicKey: normalizeSshPublicKey(form.sshPublicKey) })}
          ></textarea>
          <small>Saved in this browser for next time.</small>
        </label>
      </div>

      <div class="quote-strip">
        <div class:quote-ok={validation.quote != null} class:quote-danger={!validation.quote}>
          <span>Required for deployment</span>
          <strong>
            {validation.quote ? `${formatNumber(validation.quote.required, 4)} ${validation.quote.label}` : '-'}
          </strong>
          <small>Charged from the connected wallet's Aleph credit balance.</small>
        </div>
        <div>
          <span>Credits available</span>
          <strong>{balance ? formatNumber(balance.credit_balance, 0) : '-'}</strong>
          <small>{wallet ? 'Refresh if you topped up credits in another session.' : 'Connect a wallet to load credits.'}</small>
        </div>
        <div>
          <span>Rootfs source</span>
          <strong>
            {usingBaseRootfs ? selectedBaseRootfs.label : rootfsState.manifest?.version ?? 'Custom rootfs'}
          </strong>
          {#if usingBaseRootfs}
            <small>{selectedBaseRootfs.label} is managed by Aleph.</small>
          {:else if rootfsSourceSizeMiB != null}
            <small>{formatNumber(rootfsSourceSizeMiB, 2)} MiB uploaded image</small>
          {/if}
        </div>
        <div>
          <span>Resources</span>
          <strong>
            {spec ? `${spec.vcpus} vCPU / ${formatNumber(spec.memoryMiB / 1024, 1)} GiB / ${formatNumber(spec.diskMiB / 1024, 0)} GiB` : '-'}
          </strong>
        </div>
        <div>
          <span>Selected CRN</span>
          <strong>
            {selectedCrnOption ? crnDisplayLabel(selectedCrnOption) : 'Select CRN'}
          </strong>
          <small>{selectedCrnOption ? shortHash(selectedCrnOption.hash) : 'Compatible CRNs are filtered by the selected tier.'}</small>
        </div>
      </div>

      {#if prepaidConfigured}
        <div class="rootfs-panel prepaid-panel">
          <div>
            <span>Prepaid vault</span>
            <strong>{prepaidState.vaultAddress ? shortHash(prepaidState.vaultAddress, 8, 6) : 'configured'}</strong>
          </div>
          <div>
            <span>Wallet mode</span>
            <strong>{aaWalletAssessment?.kind ?? 'checking'}</strong>
          </div>
          <div>
            <span>Enforcement</span>
            <strong>{prepaidState.enforcementLevel}</strong>
          </div>
          <div>
            <span>Chain</span>
            <strong>{connectedPaymentChain ?? '-'}</strong>
          </div>
          <div>
            <span>Total prepaid</span>
            <strong>{formatNumber(prepaidTotalDisplay, 4)}</strong>
          </div>
          <div>
            <span>Available prepaid</span>
            <strong>{formatNumber(prepaidAvailableDisplay, 4)}</strong>
          </div>
          <div>
            <span>Reserved prepaid</span>
            <strong>{formatNumber(prepaidReservedDisplay, 4)}</strong>
          </div>
          <div>
            <span>Current intent</span>
            <strong>{currentIntentEnvelope ? shortHash(currentIntentEnvelope.intentHash, 8, 6) : '-'}</strong>
          </div>
          <div>
            <span>Reservation</span>
            <strong>
              {#if prepaidState.currentReservation}
                {prepaidState.currentReservation.expired ? 'expired' : prepaidState.currentReservation.consumed ? 'consumed' : 'active'}
              {:else}
                none
              {/if}
            </strong>
          </div>
          <div class="rootfs-links">
            <a href={ALEPH_PERMISSIONS_DOCS_URL} target="_blank" rel="noreferrer">Aleph permissions</a>
            <a href={ALEPH_INSTANCE_DOCS_URL} target="_blank" rel="noreferrer">Aleph instance docs</a>
          </div>
          <p class="rootfs-note">
            This prepaid flow assumes the connected wallet address is the Aleph owner and that upstream Aleph message verification can honor contract-based signatures for hard enforcement.
          </p>
          {#if currentIntentEnvelope}
            <p class="rootfs-note">
              Current intent expires {dateLabel(currentIntentEnvelope.intent.expiresAt)} and reserves {formatNumber(formatBudgetUnits(prepaidRequiredBudget), 4)} budget units.
            </p>
          {/if}
          {#if prepaidBusy}
            <p class="rootfs-note">Refreshing prepaid state…</p>
          {/if}
          {#each prepaidState.warnings as warning}
            <p class="validation-warning">{warning}</p>
          {/each}
          <div class="instance-links prepaid-actions">
            <button class="secondary-button" type="button" on:click={approveCurrentPrepaidBudget} disabled={!wallet || deployBusy || !connectedPaymentChain}>
              Approve quote
            </button>
            <button class="secondary-button" type="button" on:click={depositCurrentPrepaidBudget} disabled={!wallet || deployBusy}>
              Deposit quote
            </button>
            <button class="secondary-button" type="button" on:click={reserveCurrentDeploymentIntent} disabled={!wallet || deployBusy || !currentIntentEnvelope}>
              Reserve intent
            </button>
            <button
              class="secondary-button"
              type="button"
              on:click={refundCurrentReservation}
              disabled={!wallet || deployBusy || !prepaidState.currentReservation?.expired}
            >
              Refund expired
            </button>
            <button class="secondary-button" type="button" on:click={refreshPrepaidStateOnly} disabled={!wallet || deployBusy}>
              Refresh prepaid
            </button>
          </div>
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
            <span>Built</span>
            <strong>{rootfsCreatedAtLabel ?? '-'}</strong>
          </div>
          <div>
            <span>Uploaded to Aleph</span>
            <strong>{rootfsPublishedAtLabel ?? '-'}</strong>
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
          {#if rootfsResolution.rejectionReason}
            <p class="rootfs-note validation-error">{rootfsResolution.rejectionReason}</p>
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
        {@const details = instanceDetails[instance.item_hash]}
        {@const messageStage = instanceMessageStage(instance)}
        {@const allocationStage = instanceAllocationStage(instance)}
        {@const runtimeStage = instanceRuntimeStage(instance)}
        {@const crnExecutionsUrl = instanceCrnExecutionListUrl(instance)}
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
              <a href={explorerUrl(instance.sender, instance.item_hash)} target="_blank" rel="noreferrer">Explorer</a>
              <a href={apiMessageUrl(instance.item_hash)} target="_blank" rel="noreferrer">API</a>
              <a href={instanceSchedulerUrl(instance)} target="_blank" rel="noreferrer">Scheduler</a>
              {#if crnExecutionsUrl}
                <a href={crnExecutionsUrl} target="_blank" rel="noreferrer">CRN</a>
              {/if}
              {#if canRetryOrbitdbSetup(instance)}
                <button
                  class="instance-retry-button"
                  type="button"
                  on:click={() => retryOrbitdbRelaySetup(instance)}
                  disabled={!canRetryOrbitdbSetup(instance)}
                  title="Retry the relay setup POST with the current mapped ports"
                >
                  {instanceSetupInFlight[instance.item_hash] ? 'Retrying...' : 'Retry setup'}
                </button>
              {/if}
              {#if canStartInstance(instance)}
                <button
                  class="instance-start-button"
                  type="button"
                  on:click={() => startDeployment(instance)}
                  disabled={!canStartInstance(instance)}
                  title="Request the selected CRN to start this instance"
                >
                  {startingInstanceHash === instance.item_hash ? 'Starting...' : 'Start'}
                </button>
              {/if}
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
            <div class={`instance-stage-card instance-stage-${messageStage.tone}`}>
              <span>Aleph message</span>
              <strong>{messageStage.label}</strong>
            </div>
            <div class={`instance-stage-card instance-stage-${allocationStage.tone}`}>
              <span>Allocation</span>
              <strong>{allocationStage.label}</strong>
            </div>
            <div class={`instance-stage-card instance-stage-${runtimeStage.tone}`}>
              <span>Runtime</span>
              <strong>{runtimeStage.label}</strong>
            </div>
            {#if instanceCrnLabel(instance)}
              <div>
                <span>CRN</span>
                <strong>{instanceCrnLabel(instance)}</strong>
              </div>
            {/if}
            {#if instanceAllocationSourceLabel(instance)}
              <div>
                <span>Allocation source</span>
                <strong>{instanceAllocationSourceLabel(instance)}</strong>
              </div>
            {/if}
            {#if instanceRequestedNodeHash(instance)}
              <div>
                <span>Requested node</span>
                <strong>{shortHash(instanceRequestedNodeHash(instance) ?? '')}</strong>
              </div>
            {/if}
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
            {#if details?.execution?.networking?.ipv4_ip}
              <div>
                <span>VM IPv4</span>
                <strong>{details.execution?.networking?.ipv4_ip}</strong>
              </div>
            {/if}
            {#if details?.execution?.status?.started_at}
              <div>
                <span>Started</span>
                <strong>{dateLabel(details.execution?.status?.started_at ?? undefined)}</strong>
              </div>
            {/if}
            {#if details?.allocation?.period?.start_timestamp}
              <div>
                <span>Allocation start</span>
                <strong>{dateLabel(details.allocation.period.start_timestamp)}</strong>
              </div>
            {/if}
            {#if instanceSshCommand(instance)}
              <div class="instance-detail-wide">
                <span>SSH</span>
                <div class="instance-inline-detail">
                  <strong>{instanceSshCommand(instance)}</strong>
                  <button
                    class="instance-copy-button"
                    type="button"
                    on:click={() => copyInstanceSshCommand(instance)}
                    title="Copy SSH command"
                  >
                    {instanceSshCopied[instance.item_hash] ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            {/if}
            {#if instanceWebAccessProxyUrl(instance)}
              <div class="instance-detail-wide">
                <span>Web access</span>
                <div class="instance-detail-links">
                  <a href={instanceWebAccessProxyUrl(instance) ?? '#'} target="_blank" rel="noreferrer">
                    {instanceWebAccessProxyUrl(instance)}
                  </a>
                </div>
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
            {#if orbitdbSetupReachabilityNote(instance)}
              <div class="instance-detail-wide">
                <span>Setup</span>
                <strong>{orbitdbSetupReachabilityNote(instance)}</strong>
              </div>
            {/if}
            <div class="instance-detail-wide">
              <span>Inspect</span>
              <div class="instance-detail-links">
              <a href={explorerUrl(instance.sender, instance.item_hash)} target="_blank" rel="noreferrer">Explorer</a>
              <a href={apiMessageUrl(instance.item_hash)} target="_blank" rel="noreferrer">Aleph API</a>
              {#if showSchedulerAllocationLink(instance)}
                <a href={instanceSchedulerUrl(instance)} target="_blank" rel="noreferrer">Scheduler allocation</a>
              {/if}
              {#if crnExecutionsUrl}
                <a href={crnExecutionsUrl} target="_blank" rel="noreferrer">CRN executions</a>
              {/if}
              </div>
            </div>
            {#if instanceActionFeedback[instance.item_hash]}
              <div class="instance-detail-wide">
                <span>Action</span>
                <strong
                  class:instance-feedback-info={instanceActionFeedback[instance.item_hash]?.tone === 'info'}
                  class:instance-feedback-error={instanceActionFeedback[instance.item_hash]?.tone === 'error'}
                >
                  {instanceActionFeedback[instance.item_hash]?.message}
                </strong>
              </div>
            {/if}
            {#if details?.error}
              <div class="instance-detail-wide">
                <span>Details</span>
                <strong>{details.error}</strong>
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
