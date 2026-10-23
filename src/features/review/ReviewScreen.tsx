import { Page, Preloader, Progressbar } from 'konsta/react'
import { useState } from 'react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { BarTitle, EDGES, TopBar } from '../../components/TopBar'
import type { VaultDB } from '../../lib/db'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import type { Card } from '../../lib/types'
import { EditForm } from '../inbox/EditCardScreen'
import { CardMenu, DeleteCardDialog } from './CardMenu'
import { CardView } from './CardView'
import { DoneScreen } from './DoneScreen'
import { RatingBar } from './RatingBar'
import { useReviewKeys } from './useReviewKeys'
import type { ReviewSession } from './useReviewSession'

/** Titre d'une session lancée par « Commencer à étudier » (toutes les cartes du jour). */
export const DAY_TITLE = 'Révision du jour'

interface Props {
  session: ReviewSession
  /** Cache local : tags proposés dans « Modifier la carte » (menu ⋯, #73). */
  db: VaultDB
  now: () => Date
  /** Titre de la barre selon l'entrée (Paper, note « titre selon l'entrée ») : nom du tag, ou « Révision du jour ». */
  title?: string
  /** Retour à l'écran précédent (flèche de la barre). */
  onBack?(): void
  /** Nom accessible de la flèche : l'écran de destination. */
  backLabel?: string
  /** « Retour à l'accueil » de l'écran de fin (par défaut : onBack). */
  onHome?(): void
  /** Après une modification ou une suppression locale (menu ⋯) : synchro immédiate. */
  onWrite?(): void
}

/** Menu ⋯ (#73) : fermé, ouvert sous le bouton, ou confirmation de suppression au même endroit. */
type MenuState = { open: 'menu' | 'confirm'; anchor: DOMRect } | null

/**
 * Révision (#82, Paper « Révision · Question / Réponse ») : barre commune (flèche, titre selon l'entrée,
 * sous-titre « Carte n sur N », Recherche, Profil), barre de progression fine dessous. Le reste ne change pas.
 */
export function ReviewScreen({ session, db, now, title = DAY_TITLE, onBack, backLabel, onHome = onBack, onWrite }: Props) {
  const [menu, setMenu] = useState<MenuState>(null)
  // Carte en cours de modification (instantané à l'ouverture) : « Modifier la carte » remplace la révision.
  const [editing, setEditing] = useState<Card | null>(null)
  const [deleteFailed, setDeleteFailed] = useState(false)
  useReviewKeys(session, editing !== null)
  const { status, current, revealed } = session
  const reviewing = status === 'reviewing'

  if (editing) {
    return (
      <EditForm
        key={editing.id}
        db={db}
        title="Modifier la carte"
        initial={editing}
        source={editing.source_title?.trim() || undefined}
        minTags={editing.source === 'vault' ? 0 : 1}
        overlay
        onClose={() => setEditing(null)}
        save={async patch => { await session.edit(patch); onWrite?.() }}
      />
    )
  }

  const confirmDelete = async () => {
    setMenu(null)
    try {
      await session.remove()
      setDeleteFailed(false)
      onWrite?.()
    } catch {
      setDeleteFailed(true)
    }
  }

  // La page entière est le conteneur de défilement ; les barres en verre sont `sticky` et se
  // superposent au contenu qui passe dessous. Une carte courte tient sans scroll (#27) ; une carte
  // longue défile sous les barres, qui restent en place.
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar
        onBack={onBack}
        backLabel={backLabel}
        search={false}
        extra={reviewing && (
          <Progressbar
            className="mt-2.5"
            progress={session.progress}
            colors={{ trackBgIos: 'bg-black/8 dark:bg-white/10', activeBgIos: 'bg-primary dark:bg-new' }}
          />
        )}
      >
        <BarTitle title={title} subtitle={reviewing ? `Carte ${session.position.n} sur ${session.position.total}` : undefined} />
      </TopBar>

      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col py-2 ${EDGES}`}>
        {status === 'loading' && <div className="my-auto flex justify-center"><Preloader /></div>}
        {status === 'error' && (
          <div className="my-auto flex flex-col items-center gap-4">
            <p role="alert" className="glass-card w-full rounded-[28px] p-6 text-center text-[17px] text-label-2">
              Impossible de lire les cartes enregistrées sur cet appareil.
            </p>
            <GlassButton tone="new" className={`${GLASS_PRIMARY} max-w-xs`} onClick={session.restart}>Réessayer</GlassButton>
          </div>
        )}
        {status === 'empty' && (
          <p className="glass-card my-auto rounded-[28px] p-6 text-center text-[17px] text-label-2">
            {navigator.onLine === false
              ? 'Connecte-toi à internet pour la première synchronisation.'
              : "Aucune carte pour l'instant. Lance /flashcards sur le Mac."}
          </p>
        )}
        {status === 'done' && (
          <DoneScreen stats={session.stats} nextDueAt={session.nextDueAt} now={now()} onRestart={session.reviewAll} onHome={onHome} />
        )}
        {current && (
          <CardView
            card={current.card}
            revealed={revealed}
            onReveal={session.reveal}
            menuOpen={menu?.open === 'menu'}
            onMenu={button => setMenu({ open: 'menu', anchor: button.getBoundingClientRect() })}
          />
        )}
      </main>

      {current && (
        // Zone du bas transparente (#39) : chaque bouton est son propre verre et flotte sur le fond.
        <footer className={`action-dock sticky bottom-0 z-20 shrink-0 pt-2 pb-[max(12px,var(--k-safe-area-bottom))] ${EDGES}`}>
          <div className="mx-auto max-w-xl">
            {deleteFailed && (
              <p role="alert" className="mx-auto mb-1.5 w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">
                Carte non supprimée. Réessaie.
              </p>
            )}
            {session.saveFailed && (
              <p role="alert" className="mx-auto mb-1.5 w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">
                Note non enregistrée. Réessaie.
              </p>
            )}
            {/* Un seul emplacement d'action, sous le pouce : « Afficher la réponse », puis la notation. */}
            <div role="group" aria-label="Actions">
              {revealed
                ? <RatingBar state={current.state} now={now()} onRate={session.rate} />
                : <GlassButton tone="new" className={GLASS_PRIMARY} onClick={session.reveal}>Afficher la réponse</GlassButton>}
            </div>
          </div>
        </footer>
      )}
      {current && menu?.open === 'menu' && (
        <CardMenu
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          onEdit={() => { setMenu(null); setDeleteFailed(false); setEditing(current.card) }}
          onDelete={() => setMenu({ ...menu, open: 'confirm' })}
        />
      )}
      {current && menu?.open === 'confirm' && (
        <DeleteCardDialog anchor={menu.anchor} onConfirm={() => void confirmDelete()} onCancel={() => setMenu(null)} />
      )}
    </Page>
  )
}
