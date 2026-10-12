import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Le logo a déjà un fond plein : pas de marge blanche autour (défaut du preset pour
// maskable et apple-touch-icon), le fond reste vert-bleu jusqu'au bord.
const fill = { padding: 0, resizeOptions: { background: '#0f6b63' } }

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    transparent: { ...minimal2023Preset.transparent, ...fill },
    maskable: { ...minimal2023Preset.maskable, ...fill },
    apple: { ...minimal2023Preset.apple, ...fill },
  },
  images: ['public/logo.svg'],
})
