import { App as KApp, Page } from 'konsta/react'
import { LoginScreen } from './features/auth/LoginScreen'
import { useAuth } from './features/auth/useAuth'
import { SignedInApp } from './features/home/SignedInApp'
import { db } from './lib/db'
import { supabase } from './lib/supabase'
import { supabaseRemote, sync } from './lib/sync'
import { TRANSPARENT_PAGE } from './lib/theme'
import { useReducedMotion } from './lib/useReducedMotion'

// Hors du rendu : le sync et l'horloge doivent rester stables pour les hooks.
const remote = supabaseRemote(supabase)
const runSync = () => sync(db, remote)
const clock = () => new Date()

export default function App() {
  const { status, signIn, signOut } = useAuth()
  // Reflet des boutons en verre (lumière + grossissement à l'appui) coupé sous « Réduire les animations ».
  const reducedMotion = useReducedMotion()
  return (
    <KApp theme="ios" safeAreas iosHoverHighlight={!reducedMotion}>
      {/* Fond décoratif statique, sous toutes les pages (Page a un fond transparent). */}
      <div aria-hidden="true" className="app-backdrop" />
      {status === 'loading' && <Page colors={TRANSPARENT_PAGE} />}
      {status === 'signed-out' && <LoginScreen signIn={signIn} />}
      {status === 'signed-in' && <SignedInApp db={db} runSync={runSync} now={clock} onSignOut={signOut} />}
    </KApp>
  )
}
