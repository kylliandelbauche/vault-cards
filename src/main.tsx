import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { followColorScheme } from './lib/theme'

// Thème clair/sombre de l'appareil, suivi en direct (iPhone, Mac ou autre).
followColorScheme(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
