/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // autoUpdate : le nouveau service worker s'active tout de suite (skipWaiting + clientsClaim)
      // et les anciens précaches sont purgés ; l'app ne reste jamais bloquée sur un vieux index.html.
      registerType: 'autoUpdate',
      // Icônes générées depuis public/logo.svg : `npm run generate-pwa-assets` (voir pwa-assets.config.ts).
      // Pas d'includeAssets ni d'icônes du manifest ajoutées à part : globPatterns couvre déjà tout
      // public/ (sinon entrées en double dans le précache).
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Vault Cards',
        short_name: 'Cards',
        description: 'Révision espacée des notes de veille, même hors ligne.',
        lang: 'fr',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        background_color: '#f2f2f7',
        theme_color: '#0f6b63',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Coquille de l'app uniquement (précache). Aucun runtimeCaching : les appels Supabase
        // (REST, auth) vont toujours au réseau ; le hors ligne des données, c'est Dexie.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        // Seules les navigations vers l'app reçoivent index.html : pas les fichiers (…/x.ext),
        // ni /api/ ou /.well-known/ s'ils apparaissent un jour.
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//, /\/[^/?]+\.[^/?]+(\?.*)?$/],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Valeurs factices : les tests ne dépendent jamais de .env.local (absent en CI) ni du vrai projet.
    env: { VITE_SUPABASE_URL: 'http://localhost:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' },
  },
})
