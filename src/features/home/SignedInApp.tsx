import { useEffect, useMemo, useRef } from 'react'
import { BarActionsProvider } from '../../components/TopBar'
import type { VaultDB } from '../../lib/db'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import { pendingCount } from '../../lib/sync'
import { dexieStore } from '../review/dexieStore'
import { DAY_TITLE, ReviewScreen } from '../review/ReviewScreen'
import { safeSignOut } from '../review/safeSignOut'
import { syncIndicator, useAutoSync, usePendingCount } from '../review/useAutoSync'
import { useReviewSession, type ReviewSession } from '../review/useReviewSession'
import { DraftsScreen } from '../inbox/DraftsScreen'
import { EditCardScreen, NewCardScreen } from '../inbox/EditCardScreen'
import { NewCardsBlock } from '../inbox/NewCardsBlock'
import { SourceTextScreen } from '../inbox/SourceTextScreen'
import { sourceName } from '../inbox/sourceName'
import { MyCardsScreen } from '../cards/MyCardsScreen'
import { HomeScreen } from './HomeScreen'
import { TagsScreen } from './TagsScreen'
import { useHomeData } from './useHomeData'
import { LeaveGuardContext } from './useLeaveGuard'
import { useNavigation, type Screen } from './useNavigation'

/** Nom accessible de la flèche retour : l'écran de destination. */
const backLabel = (to: Screen | null) =>
  to?.name === 'tags' ? 'Mes tags' : to?.name === 'review' ? to.scope.tag ?? DAY_TITLE : 'Accueil'

interface Props {
  db: VaultDB
  /** Synchro avec Supabase (injectée : faux serveur en test). */
  runSync(): Promise<{ pulledCards: number; pulledReviews: number }>
  now(): Date
  onSignOut(): void
  /** Boîte de réception (#81) : client Supabase. Absent (tests de l'accueil) : pas de bloc « Nouvelles cartes ». */
  inbox?: InboxDeps
}

/**
 * App connectée : Accueil (→ Mes tags) → Révision (toutes les cartes ou un tag) → Fin de session → Accueil.
 * Boîte de réception (#81) : Accueil → Source · Texte (remplacé par Brouillons après l'envoi) ou Brouillons → Modifier.
 * La session et la synchro vivent ici, au-dessus des écrans : l'indicateur de synchro ne repart pas de zéro
 * à chaque changement d'écran, et une seule synchro tourne à la fois.
 */
export function SignedInApp(props: Props) {
  const { db, runSync, onSignOut } = props
  const { registerGuard, ...nav } = useNavigation()
  const { openCards } = nav
  // Loupe → « Mes cartes » (#80). Déconnexion : jamais de révisions perdues, synchro d'abord, confirmation si elle
  // échoue ; accessible depuis Profil (barre du haut).
  const barActions = useMemo(() => ({
    onSearch: openCards,
    onSignOut: () => {
      void safeSignOut({ pending: () => pendingCount(db), sync: runSync, confirm: m => window.confirm(m), signOut: onSignOut })
    },
  }), [db, runSync, onSignOut, openCards])
  return (
    <BarActionsProvider value={barActions}>
      <LeaveGuardContext.Provider value={registerGuard}><SignedInScreens {...props} nav={nav} /></LeaveGuardContext.Provider>
    </BarActionsProvider>
  )
}

function SignedInScreens({ db, runSync, now, inbox, nav }: Props & { nav: Omit<ReturnType<typeof useNavigation>, 'registerGuard'> }) {
  const store = useMemo(() => dexieStore(db), [db])
  const { screen, previous, openReview, openTags, open, replace, back, goHome } = nav
  const scope = screen.name === 'review' ? screen.scope : null
  const session = useReviewSession(store, now, scope)
  const autoSyncOptions = useMemo(() => ({ pending: () => pendingCount(db) }), [db])
  const { syncNow, ...syncState } = useAutoSync(session, runSync, autoSyncOptions)
  const pending = usePendingCount(db)
  const sync = syncIndicator(pending, syncState)

  // Accueil et Mes tags : abonnés au cache seulement quand ils sont affichés ; les derniers chiffres restent pendant la révision.
  const homeData = useHomeData(db, now, screen.name === 'home' || screen.name === 'tags')

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

  if (screen.name === 'review') {
    return (
      <ReviewScreen
        session={session}
        db={db}
        now={now}
        title={screen.scope.tag ?? DAY_TITLE}
        onBack={back}
        backLabel={previous?.name === 'tags' ? 'Mes tags' : 'Accueil'}
        onHome={goHome}
        onWrite={syncNow}
      />
    )
  }
  const draftsOf = (item: InboxItem) => ({ name: 'drafts' as const, inboxId: item.id, source: sourceName(item) })
  if (inbox && screen.name === 'source-text') {
    return <SourceTextScreen deps={inbox} onClose={back} onSent={item => replace(draftsOf(item))} />
  }
  if (inbox && screen.name === 'drafts') {
    return (
      <DraftsScreen
        db={db}
        deps={inbox}
        target={screen}
        syncState={syncState}
        onBack={back}
        onEdit={cardId => open({ name: 'edit', cardId, inboxId: screen.inboxId, source: screen.source })}
        onSync={syncNow}
        onDone={goHome}
      />
    )
  }
  if (screen.name === 'cards') {
    return <MyCardsScreen db={db} onBack={back} backLabel={backLabel(previous)} onWrite={syncNow} />
  }
  if (screen.name === 'new-card') {
    return <NewCardScreen db={db} onClose={back} onWrite={syncNow} />
  }
  if (screen.name === 'edit') {
    return <EditCardScreen db={db} target={screen} onClose={back} onWrite={syncNow} />
  }
  const study = (tag?: string) => openReview({ mode: 'due', tag })
  if (screen.name === 'tags') {
    return <TagsScreen data={homeData} onStudy={study} onBack={back} />
  }
  return (
    <HomeScreen
      data={homeData}
      now={now}
      sync={sync}
      onStudy={study}
      onReviewAll={() => openReview({ mode: 'all' })}
      onOpenTags={openTags}
      newCards={inbox && (
        <NewCardsBlock
          db={db}
          deps={inbox}
          onManual={() => open({ name: 'new-card' })}
          onText={() => open({ name: 'source-text' })}
          onSent={item => open(draftsOf(item))}
          onOpenDrafts={() => open({ name: 'drafts' })}
        />
      )}
    />
  )
}
