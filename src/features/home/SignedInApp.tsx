import { useEffect, useMemo, useRef } from 'react'
import { getTag } from '../../../shared/tags'
import type { VaultDB } from '../../lib/db'
import { pendingCount } from '../../lib/sync'
import { dexieStore } from '../review/dexieStore'
import { ReviewScreen } from '../review/ReviewScreen'
import { safeSignOut } from '../review/safeSignOut'
import { syncIndicator, useAutoSync, usePendingCount } from '../review/useAutoSync'
import { useReviewSession } from '../review/useReviewSession'
import { HomeScreen } from './HomeScreen'
import { useHomeData } from './useHomeData'
import { useNavigation } from './useNavigation'

interface Props {
  db: VaultDB
  /** Synchro avec Supabase (injectée : faux serveur en test). */
  runSync(): Promise<{ pulledCards: number; pulledReviews: number }>
  now(): Date
  onSignOut(): void
}

/**
 * App connectée : Accueil → Révision (toutes les cartes ou un tag) → Fin de session → Accueil.
 * La session et la synchro vivent ici, au-dessus des écrans : l'indicateur de synchro ne repart pas de zéro
 * à chaque changement d'écran, et une seule synchro tourne à la fois.
 */
export function SignedInApp({ db, runSync, now, onSignOut }: Props) {
  const store = useMemo(() => dexieStore(db), [db])
  const { screen, openReview, goHome } = useNavigation()
  const scope = screen.name === 'review' ? screen.scope : null
  const session = useReviewSession(store, now, scope)
  const { syncNow, ...syncState } = useAutoSync(session, runSync)
  const pending = usePendingCount(db)
  const sync = syncIndicator(pending, syncState)

  // Retour à l'accueil au milieu d'une session : pousse tout de suite les notes déjà données.
  const wasReviewing = useRef(false)
  useEffect(() => {
    if (screen.name === 'review') { wasReviewing.current = true; return }
    if (!wasReviewing.current) return
    wasReviewing.current = false
    if (pending > 0) syncNow()
  }, [screen, pending, syncNow])

  // Jamais de révisions perdues : synchro d'abord, confirmation si elle échoue.
  const signOutSafely = () => {
    void safeSignOut({ pending: () => pendingCount(db), sync: runSync, confirm: m => window.confirm(m), signOut: onSignOut })
  }

  if (screen.name === 'review') {
    const tag = screen.scope.tag ? getTag(screen.scope.tag) : undefined
    return (
      <ReviewScreen
        session={session}
        now={now}
        sync={sync}
        title={tag ? `${tag.emoji} ${tag.label}` : undefined}
        onBack={goHome}
      />
    )
  }
  return (
    <Home
      db={db}
      now={now}
      sync={sync}
      onStudy={tag => openReview({ mode: 'due', tag })}
      onReviewAll={() => openReview({ mode: 'all' })}
      onSignOut={signOutSafely}
    />
  )
}

/** Accueil monté seulement quand il est affiché : l'abonnement au cache s'arrête pendant la révision. */
function Home({ db, now, ...rest }: Omit<Parameters<typeof HomeScreen>[0], 'data'> & { db: VaultDB }) {
  const data = useHomeData(db, now)
  return <HomeScreen data={data} now={now} {...rest} />
}
