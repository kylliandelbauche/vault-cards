import { Page, Preloader, Progressbar } from 'konsta/react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { BarTitle, EDGES, TopBar } from '../../components/TopBar'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { CardView } from './CardView'
import { DoneScreen } from './DoneScreen'
import { RatingBar } from './RatingBar'
import { useReviewKeys } from './useReviewKeys'
import type { ReviewSession } from './useReviewSession'

/** Titre d'une session lancée par « Commencer à étudier » (toutes les cartes du jour). */
export const DAY_TITLE = 'Révision du jour'

interface Props {
  session: ReviewSession
  now: () => Date
  /** Titre de la barre selon l'entrée (Paper, note « titre selon l'entrée ») : nom du tag, ou « Révision du jour ». */
  title?: string
  /** Retour à l'écran précédent (flèche de la barre). */
  onBack?(): void
  /** Nom accessible de la flèche : l'écran de destination. */
  backLabel?: string
  /** « Retour à l'accueil » de l'écran de fin (par défaut : onBack). */
  onHome?(): void
}

/**
 * Révision (#82, Paper « Révision · Question / Réponse ») : barre commune (flèche, titre selon l'entrée,
 * sous-titre « Carte n sur N », Recherche, Profil), barre de progression fine dessous. Le reste ne change pas.
 */
export function ReviewScreen({ session, now, title = DAY_TITLE, onBack, backLabel, onHome = onBack }: Props) {
  useReviewKeys(session)
  const { status, current, revealed } = session
  const reviewing = status === 'reviewing'

  // La page entière est le conteneur de défilement ; les barres en verre sont `sticky` et se
  // superposent au contenu qui passe dessous. Une carte courte tient sans scroll (#27) ; une carte
  // longue défile sous les barres, qui restent en place.
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar
        onBack={onBack}
        backLabel={backLabel}
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
        {current && <CardView card={current.card} revealed={revealed} onReveal={session.reveal} />}
      </main>

      {current && (
        // Zone du bas transparente (#39) : chaque bouton est son propre verre et flotte sur le fond.
        <footer className={`action-dock sticky bottom-0 z-20 shrink-0 pt-2 pb-[max(12px,var(--k-safe-area-bottom))] ${EDGES}`}>
          <div className="mx-auto max-w-xl">
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
    </Page>
  )
}
