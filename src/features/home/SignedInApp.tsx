import { useCallback, useEffect, useMemo, useRef } from 'react'
import { BarActionsProvider } from '../../components/TopBar'
import type { VaultDB } from '../../lib/db'
import type { ProfileDeps } from '../../lib/account'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import { pendingCount } from '../../lib/sync'
import { dexieStore } from '../review/dexieStore'
import { DAY_TITLE, FILTERED_TITLE, ReviewScreen } from '../review/ReviewScreen'
import { safeSignOut } from '../review/safeSignOut'
import { syncIndicator, useAutoSync, usePendingCount } from '../review/useAutoSync'
import { useReviewSession, type ReviewSession, type SessionScope } from '../review/useReviewSession'
import { DraftsScreen } from '../inbox/DraftsScreen'
import { EditCardScreen, NewCardScreen } from '../inbox/EditCardScreen'
import { NewCardsBlock } from '../inbox/NewCardsBlock'
import { NewCardsHub } from '../inbox/NewCardsHub'
import { SourceTextScreen } from '../inbox/SourceTextScreen'
import { SourceVoiceScreen } from '../inbox/SourceVoiceScreen'
import { sourceName } from '../inbox/sourceName'
import { MyCardsScreen } from '../cards/MyCardsScreen'
import { ProfileScreen } from '../profile/ProfileScreen'
import { HomeScreen } from './HomeScreen'
import { TagsScreen } from './TagsScreen'
import { useHomeData } from './useHomeData'
import { LeaveGuardContext } from './useLeaveGuard'
import { useNavigation, type Screen } from './useNavigation'

/** Titre de la barre selon l'entrée : nom du tag, « Cartes filtrées » (liste de cartes de Mes cartes, #105) ou « Révision du jour ». */
const reviewTitle = (scope: SessionScope) => scope.tag ?? (scope.cardIds ? FILTERED_TITLE : DAY_TITLE)

/** Nom accessible de la flèche retour : l'écran de destination. */
const backLabel = (to: Screen | null) =>
  to?.name === 'tags' ? 'Mes tags' : to?.name === 'profile' ? 'Profil' : to?.name === 'hub' ? 'Nouvelles cartes' : to?.name === 'drafts' ? 'Brouillons' : to?.name === 'cards' ? 'Mes cartes' : to?.name === 'review' ? reviewTitle(to.scope) : 'Accueil'

interface Props {
  db: VaultDB
  /** Synchro avec Supabase (injectée : faux serveur en test). */
  runSync(): Promise<{ pulledCards: number; pulledReviews: number }>
  now(): Date
  onSignOut(): void
  /** Boîte de réception (#81) : client Supabase. Absent (tests de l'accueil) : pas de bloc « Nouvelles cartes ». */
  inbox?: InboxDeps
  /** Profil (#83) : client Supabase (auth seulement). Absent (tests des autres écrans) : pas de bouton Profil. */
  profile?: ProfileDeps
}

/**
 * App connectée : Accueil (→ Mes tags) → Révision (toutes les cartes ou un tag) → Fin de session → Accueil.
 * Boîte de réception (#81) : Accueil → Source · Texte ou Vocal (remplacé par Brouillons après l'envoi) ou Brouillons → Modifier.
 * La session et la synchro vivent ici, au-dessus des écrans : l'indicateur de synchro ne repart pas de zéro
 * à chaque changement d'écran, et une seule synchro tourne à la fois.
 */
export function SignedInApp(props: Props) {
  const { db, runSync, onSignOut, profile } = props
  const { registerGuard, ...nav } = useNavigation()
  const { openCards, openProfile } = nav
  // Déconnexion : jamais de révisions perdues, synchro d'abord, confirmation si elle échoue ; bouton du Profil (#83).
  const signOut = useCallback(() => {
    void safeSignOut({ pending: () => pendingCount(db), sync: runSync, confirm: m => window.confirm(m), signOut: onSignOut })
  }, [db, runSync, onSignOut])
  // Loupe → « Mes cartes » (#80) ; Profil → écran Profil (#83).
  const barActions = useMemo(() => ({ onSearch: openCards, onProfile: profile ? openProfile : undefined }), [openCards, openProfile, profile])
  return (
    <BarActionsProvider value={barActions}>
      <LeaveGuardContext.Provider value={registerGuard}><SignedInScreens {...props} nav={nav} onSignOutSafe={signOut} /></LeaveGuardContext.Provider>
    </BarActionsProvider>
  )
}

function SignedInScreens({ db, runSync, now, inbox, profile, nav, onSignOutSafe }: Props & { nav: Omit<ReturnType<typeof useNavigation>, 'registerGuard'>; onSignOutSafe(): void }) {
  const store = useMemo(() => dexieStore(db), [db])
  const { screen, previous, stack, openReview, openTags, openCards, open, replace, back, goHome } = nav
  // Une révision en cours garde sa session sous tout écran posé dessus (Profil #83, puis Mes cartes ou Mes tags) :
  // le périmètre reste celui de la révision de la pile, il n'y en a jamais deux. Une révision lancée depuis Mes cartes ou
  // Mes tags posés sur celle-ci (Profil › Cartes › Étudier) en ajoute une deuxième : c'est la plus haute qui s'applique.
  const scope = stack.findLast((s): s is Extract<Screen, { name: 'review' }> => s.name === 'review')?.scope ?? null
  const session = useReviewSession(store, now, scope)
  const autoSyncOptions = useMemo(() => ({ pending: () => pendingCount(db) }), [db])
  const { syncNow, ...syncState } = useAutoSync(session, runSync, autoSyncOptions)
  const pending = usePendingCount(db)
  const sync = syncIndicator(pending, syncState)

  // Accueil, Mes tags et Profil : abonnés au cache seulement quand ils sont affichés ; les derniers chiffres restent pendant la révision.
  const homeData = useHomeData(db, now, screen.name === 'home' || screen.name === 'tags' || screen.name === 'profile')

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
        title={reviewTitle(screen.scope)}
        onBack={back}
        backLabel={previous?.name === 'tags' ? 'Mes tags' : previous?.name === 'cards' ? 'Mes cartes' : 'Accueil'}
        onHome={goHome}
        onWrite={syncNow}
      />
    )
  }
  const draftsOf = (item: InboxItem) => ({ name: 'drafts' as const, inboxId: item.id, source: sourceName(item) })
  if (inbox && screen.name === 'source-text') {
    return <SourceTextScreen deps={inbox} onClose={back} onSent={item => replace(draftsOf(item))} />
  }
  if (inbox && screen.name === 'source-voice') {
    return <SourceVoiceScreen deps={inbox} onClose={back} onSent={item => replace(draftsOf(item))} />
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
  if (inbox && screen.name === 'hub') {
    return (
      <NewCardsHub
        db={db}
        deps={inbox}
        now={now}
        onBack={back}
        onManual={() => open({ name: 'new-card' })}
        onText={() => open({ name: 'source-text' })}
        onVoice={() => open({ name: 'source-voice' })}
        onSent={item => open(draftsOf(item))}
        // Dernière génération : ses brouillons s'il en reste, sinon ses cartes dans « Mes cartes ».
        onOpenGeneration={last => open(last.drafts > 0
          ? { name: 'drafts', inboxId: last.inboxId, source: last.title }
          : { name: 'cards', documentId: last.inboxId })}
      />
    )
  }
  if (profile && screen.name === 'profile') {
    return (
      <ProfileScreen
        deps={profile}
        data={homeData}
        sync={sync}
        view={screen.view}
        backLabel={backLabel(previous)}
        onBack={back}
        onOpenCards={openCards}
        onOpenTags={openTags}
        onOpenEmail={() => open({ name: 'profile', view: 'email' })}
        onOpenPassword={() => open({ name: 'profile', view: 'password' })}
        onSignOut={onSignOutSafe}
      />
    )
  }
  if (screen.name === 'cards') {
    return (
      <MyCardsScreen
        db={db}
        initialDocumentId={screen.documentId}
        initialQuery={screen.query}
        onBack={back}
        backLabel={backLabel(previous)}
        onWrite={syncNow}
        // Révision libre des cartes filtrées (#105) : ne consomme pas le quota de nouvelles cartes.
        // Le filtre est gardé sur l'entrée de la pile : le retour de la révision le retrouve (#125).
        onStudy={(cardIds, filter) => {
          replace({ name: 'cards', ...filter })
          openReview({ mode: 'all', cardIds })
        }}
      />
    )
  }
  if (screen.name === 'new-card') {
    return <NewCardScreen db={db} onClose={back} onWrite={syncNow} />
  }
  if (screen.name === 'edit') {
    return <EditCardScreen db={db} target={screen} onClose={back} onWrite={syncNow} />
  }
  const study = (tag?: string) => openReview({ mode: 'due', tag })
  if (screen.name === 'tags') {
    return <TagsScreen data={homeData} onStudy={study} onBack={back} backLabel={backLabel(previous)} />
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
          onVoice={() => open({ name: 'source-voice' })}
          onSent={item => open(draftsOf(item))}
          onOpenDrafts={() => open({ name: 'drafts' })}
          onOpenHub={() => open({ name: 'hub' })}
        />
      )}
    />
  )
}
