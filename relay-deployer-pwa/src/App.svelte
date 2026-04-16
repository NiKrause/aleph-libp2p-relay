<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchBalance, fetchCrns, fetchInstances } from './lib/alephApi'
  import { deployInstance } from './lib/alephMessage'
  import { DEFAULT_DEPLOYMENT_FORM, compatibleCrns, selectedTier, tierSpec, validateDeployment } from './lib/deployment'
  import { explorerUrl, apiMessageUrl, dateLabel, formatNumber, shortHash } from './lib/format'
  import { fetchInstancePricing, holdSupportedTiers } from './lib/pricing'
  import { loadRootfsManifest, verifyRootfsExists } from './lib/rootfsManifest'
  import { connectWallet, switchPaymentChain, type WalletState } from './lib/wallet'
  import { HOLD_MAX_COMPUTE_UNITS } from './lib/config'
  import type {
    BalanceResponse,
    Crn,
    DeploymentForm,
    DeploymentResult,
    InstanceMessage,
    PricingState,
    RootfsManifestState,
    Tier
  } from './lib/types'

  let form: DeploymentForm = { ...DEFAULT_DEPLOYMENT_FORM }
  let wallet: WalletState | null = null
  let balance: BalanceResponse | null = null
  let rootfsState: RootfsManifestState = { manifest: null, valid: false, errors: ['Rootfs manifest not loaded.'] }
  let rootfsVerified = false
  let pricingState: PricingState = { pricing: null, fetchedAt: null }
  let crns: Crn[] = []
  let instances: InstanceMessage[] = []
  let deploymentResult: DeploymentResult | null = null
  let networkBusy = false
  let walletBusy = false
  let deployBusy = false
  let statusText = 'Ready'
  let errorText = ''
  const paymentChains: DeploymentForm['paymentChain'][] = ['BASE', 'AVAX', 'ETH']

  $: pricing = pricingState.pricing
  $: tier = selectedTier(pricing, form.tierId)
  $: spec = pricing && tier ? tierSpec(pricing, tier) : null
  $: crnOptions = spec ? compatibleCrns(crns, spec) : []
  $: validation = validateDeployment({
    form,
    manifest: rootfsState.manifest,
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

  onMount(() => {
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
        } catch (error) {
          rootfsVerified = false
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
        } catch (error) {
          rootfsVerified = false
          refreshErrors.push(`Rootfs verification: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      selectCompatibleTier()
      selectDefaultCrn()

      if (refreshErrors.length) {
        throw new Error(refreshErrors.join(' '))
      }
    })
  }

  async function refreshInstancesOnly() {
    if (!wallet) return
    const connectedWallet = wallet
    await runTask('Refreshing instances', async () => {
      instances = await fetchInstances(connectedWallet.address)
      balance = await fetchBalance(connectedWallet.address)
    })
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
      if (!pricing || !tier || !rootfsState.manifest) throw new Error('Network data is incomplete.')
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
        manifest: rootfsState.manifest,
        pricing,
        tier,
        selectedCrn
      })

      instances = await fetchInstances(wallet.address)
      balance = await fetchBalance(wallet.address)
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

  function crnHost(address: string) {
    try {
      return new URL(address).host
    } catch {
      return address
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
          <span class:ok={rootfsState.valid && rootfsVerified}></span>
          <div>
            <strong>Rootfs</strong>
            <small>{rootfsState.manifest?.version ?? 'missing'}</small>
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
          <span>Available ALEPH</span>
          <strong>{balance ? formatNumber(Number(balance.balance) - Number(balance.locked_amount), 4) : '-'}</strong>
        </div>
        <div>
          <span>Credits</span>
          <strong>{balance ? formatNumber(balance.credit_balance, 0) : '-'}</strong>
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

      {#if rootfsState.errors.length}
        <div class="alert warning" role="status">{rootfsState.errors.join(' ')}</div>
      {:else if !rootfsVerified}
        <div class="alert warning" role="status">Rootfs ItemHash is formatted but not verified on Aleph.</div>
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
                <option value={crn.hash}>{crn.name || shortHash(crn.hash)} - {crnHost(crn.address)}</option>
              {/each}
            </select>
          </label>
        {/if}

        <label class="wide">
          <span>SSH public key</span>
          <textarea bind:value={form.sshPublicKey} rows="4" spellcheck="false" placeholder="ssh-ed25519 ..."></textarea>
        </label>
      </div>

      <div class="quote-strip">
        <div>
          <span>Required</span>
          <strong>
            {validation.quote ? `${formatNumber(validation.quote.required, 4)} ${validation.quote.label}` : '-'}
          </strong>
        </div>
        <div>
          <span>Resources</span>
          <strong>
            {spec ? `${spec.vcpus} vCPU / ${formatNumber(spec.memoryMiB / 1024, 1)} GiB / ${formatNumber(spec.diskMiB / 1024, 0)} GiB` : '-'}
          </strong>
        </div>
        <div>
          <span>Rootfs</span>
          <strong>{rootfsState.manifest ? shortHash(rootfsState.manifest.rootfsItemHash) : '-'}</strong>
        </div>
      </div>

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
        <button class="primary-button launch" type="button" on:click={submitDeployment} disabled={deployBusy || walletBusy || !validation.ok || !wallet}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4 2 6 6 6 11l3 3-4 1-1 4-3-3c-5 0-9-2-11-6 4 0 7-2 7-7l3-3Zm0 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /></svg>
          Deploy
        </button>
      </div>

      {#if deploymentResult && wallet}
        <div class="result-panel">
          <div>
            <span>Instance hash</span>
            <strong>{deploymentResult.itemHash}</strong>
          </div>
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
            <span>{shortHash(instance.item_hash)} · {dateLabel(instance.time)}</span>
          </div>
          <div>
            <span>{instance.content?.payment?.type ?? '-'}</span>
            <a href={explorerUrl(instance.sender, instance.item_hash)} target="_blank" rel="noreferrer">Open</a>
          </div>
        </article>
      {:else}
        <div class="empty-state">Connect a wallet to load deployments.</div>
      {/each}
    </div>
  </section>
</main>
