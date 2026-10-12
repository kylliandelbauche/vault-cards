import { App as KApp, Page } from 'konsta/react'
import { LoginScreen } from './features/auth/LoginScreen'
import { useAuth } from './features/auth/useAuth'
import { dexieStore } from './features/review/dexieStore'
import { ReviewScreen } from './features/review/ReviewScreen'
import { syncIndicator, useAutoSync, usePendingCount } from './features/review/useAutoSync'
import { useReviewSession } from './features/review/useReviewSession'
import { db } from './lib/db'
import { supabase } from './lib/supabase'
import { supabaseRemote, sync } from './lib/sync'

// Hors du rendu : le store, l'horloge et le sync doivent rester stables pour les hooks.
// Le hook ne relit le store qu'au montage et à restart() : useAutoSync appelle restart()
// quand un sync ramène des données alors que la session peut être rechargée sans perte.
const store = dexieStore(db)
const remote = supabaseRemote(supabase)
const runSync = () => sync(db, remote)
const clock = () => new Date()

function Review({ onSignOut }: { onSignOut(): void }) {
  const session = useReviewSession(store, clock)
  const syncState = useAutoSync(session, runSync)
  const pending = usePendingCount(db)
  return <ReviewScreen session={session} now={clock} sync={syncIndicator(pending, syncState)} onSignOut={onSignOut} />
}

export default function App() {
  const { status, signIn, signOut } = useAuth()
  return (
    <KApp theme="ios" safeAreas>
      {status === 'loading' && <Page />}
      {status === 'signed-out' && <LoginScreen signIn={signIn} />}
      {status === 'signed-in' && <Review onSignOut={signOut} />}
    </KApp>
  )
}
