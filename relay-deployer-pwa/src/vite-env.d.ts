/// <reference types="vite/client" />

declare const __APP_VERSION__: string | undefined

interface EthereumProvider {
  isMetaMask?: boolean
  request<T = unknown>(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<T>
  on?(event: 'accountsChanged' | 'chainChanged', handler: (...args: unknown[]) => void): void
  removeListener?(event: 'accountsChanged' | 'chainChanged', handler: (...args: unknown[]) => void): void
}

interface Window {
  ethereum?: EthereumProvider
}

interface ImportMetaEnv {
  readonly VITE_PREPAID_VAULT_ADDRESS?: string
  readonly VITE_PREPAID_RESERVATION_TTL_SECONDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
