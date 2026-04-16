import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,webp,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'navigation-cache',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 7 * 24 * 60 * 60
              }
            }
          },
          {
            urlPattern: ({ request }) =>
              request.destination === 'script' ||
              request.destination === 'style' ||
              request.destination === 'font' ||
              request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'asset-cache',
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 30 * 24 * 60 * 60
              }
            }
          },
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://api2.aleph.im' ||
              url.origin === 'https://crns-list.aleph.sh',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'aleph-api-cache',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 80,
                maxAgeSeconds: 5 * 60
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts']
  },
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname
    }
  }
})
