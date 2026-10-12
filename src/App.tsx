import { App as KApp } from 'konsta/react'
import { ReviewScreen } from './features/review/ReviewScreen'
import { memoryStore, useReviewSession } from './features/review/useReviewSession'
import { SAMPLE_CARDS } from './lib/sample-cards'

// Hors du rendu : le store et l'horloge doivent rester stables pour le hook.
const store = memoryStore(SAMPLE_CARDS)
const clock = () => new Date()

export default function App() {
  const session = useReviewSession(store, clock)
  return (
    <KApp theme="ios" safeAreas>
      <ReviewScreen session={session} now={clock} />
    </KApp>
  )
}
