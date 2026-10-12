import { App as KApp, Page } from 'konsta/react'
import { LoginScreen } from './features/auth/LoginScreen'
import { useAuth } from './features/auth/useAuth'
import { ReviewScreen } from './features/review/ReviewScreen'
import { memoryStore, useReviewSession } from './features/review/useReviewSession'
import { SAMPLE_CARDS } from './lib/sample-cards'

// Hors du rendu : le store et l'horloge doivent rester stables pour le hook.
const store = memoryStore(SAMPLE_CARDS)
const clock = () => new Date()

function Review({ onSignOut }: { onSignOut(): void }) {
  const session = useReviewSession(store, clock)
  return <ReviewScreen session={session} now={clock} onSignOut={onSignOut} />
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
