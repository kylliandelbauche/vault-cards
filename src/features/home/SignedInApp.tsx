import { useEffect, useMemo, useRef } from 'react'
import { getTag } from '../../../shared/tags'
import type { VaultDB } from '../../lib/db'
import { pendingCount } from '../../lib/sync'
import { dexieStore } from '../review/dexieStore'
import { ReviewScreen } from '../review/ReviewScreen'
import { safeSignOut } from '../review/safeSignOut'
import { syncIndicator, useAutoSync, usePendingCount } from '../review/useAutoSync'
import { useReviewSession, type ReviewSession } from '../review/useReviewSession'
import { HomeScreen } from './HomeScreen'
import { TagsScreen } from './TagsScreen'
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
 * App connectée : Accueil (→ Mes tags) → Révision (toutes les cartes ou un tag) → Fin de session → Accueil.
 * La session et la synchro vivent ici, au-dessus des écrans : l'indicateur de synchro ne repart pas de zéro
 * à chaque changement d'écran, et une seule synchro tourne à la fois.
 */
export function SignedInApp({ db, runSync, now, onSignOut }: Props) {
  const store = useMemo(() => dexieStore(db), [db])
  const { screen, previous, openReview, openTags, back, goHome } = useNavigation()
  const scope = screen.name === 'review' ? screen.scope : null
  const session = useReviewSession(store, now, scope)
  const autoSyncOptions = useMemo(() => ({ pending: () => pendingCount(db) }), [db])
  const { syncNow, ...syncState } = useAutoSync(session, runSync, autoSyncOptions)
  const pending = usePendingCount(db)
  const sync = syncIndicator(pending, syncState)

  // Accueil et Mes tags : abonnés au cache seulement quand ils sont affichés ; les derniers chiffres restent pendant la révision.
  const homeData = useHomeData(db, now, screen.name !== 'review')

  // Retour à l'accueil au milieu d'une session : pousse tout de suite les notes déjà données. Après une session
  // terminée, useAutoSync a déjà lancé la synchro de fin : pas de seconde synchro.
  const leftStatus = useRef<ReviewSession['status'] | null>(null)
  useEffect(() => {
    if (screen.name === 'review') { leftStatus.current = session.status; return }
    const last = leftStatus.current
    if (last === null) return
    leftStatus.current = null
    if (last !== 'done' && pending !== 0) syncNow() // null (pas encore compté) : dans le doute, on pousse
  }, [screen, session.status, pending, syncNow])

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
        title={tag?.label}
        onBack={back}
        backLabel={previous?.name === 'tags' ? 'Mes tags' : 'Accueil'}
        onHome={goHome}
      />
    )
  }
  const study = (tag?: string) => openReview({ mode: 'due', tag })
  if (screen.name === 'tags') {
    return <TagsScreen data={homeData} sync={sync} onStudy={study} onBack={back} />
  }
  return (
    <HomeScreen
      data={homeData}
      now={now}
      sync={sync}
      onStudy={study}
      onReviewAll={() => openReview({ mode: 'all' })}
      onOpenTags={openTags}
      onSignOut={signOutSafely}
    />
  )
}
