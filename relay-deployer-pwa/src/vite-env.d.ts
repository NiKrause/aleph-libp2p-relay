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
