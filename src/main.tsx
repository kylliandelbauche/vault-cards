import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Konsta active son thème sombre via la classe `.dark` : on suit le réglage du système.
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const syncDark = () => document.documentElement.classList.toggle('dark', darkQuery.matches)
syncDark()
darkQuery.addEventListener('change', syncDark)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
