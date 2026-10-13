import { Page, Preloader, Progressbar } from 'konsta/react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { BackButton, BarTitle, EDGES, TopBar, type SyncIndicator } from '../../components/TopBar'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { CardView } from './CardView'
import { DoneScreen } from './DoneScreen'
import { RatingBar } from './RatingBar'
import { useReviewKeys } from './useReviewKeys'
import type { ReviewSession } from './useReviewSession'

interface Props {
  session: ReviewSession
  now: () => Date
  /** État de la synchro, affiché sous le titre. */
  sync?: SyncIndicator
  /** Titre de la barre : nom du tag pour une session limitée à un tag. */
  title?: string
  /** Retour à l'accueil (chevron de la barre, bouton de l'écran de fin). */
  onBack?(): void
}

function Counters({ counts }: Pick<ReviewSession, 'counts'>) {
  const pills = [
    { n: counts.new, label: 'nouvelles', cls: 'bg-new-tint text-new' },
    { n: counts.learn, label: 'à revoir', cls: 'bg-again-tint text-again' },
    { n: counts.due, label: 'dues', cls: 'bg-good-tint text-good' },
  ]
  return (
    // Pastilles à fond propre (≥ 5:1 quel que soit le verre). Libellé en texte masqué : VoiceOver lit
    // « 12 nouvelles » (un aria-label sur un <span> sans rôle est ignoré).
    <div className="flex shrink-0 gap-1.5">
      {pills.map(p => (
        <span key={p.label} className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[13px] font-semibold tabular-nums ${p.cls}`}>
          {p.n}
          <span className="sr-only"> {p.label}</span>
        </span>
      ))}
    </div>
  )
}

export function ReviewScreen({ session, now, sync, title = 'Vault Cards', onBack }: Props) {
  useReviewKeys(session)
  const { status, current, revealed } = session

  // La page entière est le conteneur de défilement ; les barres en verre sont `sticky` et se
  // superposent au contenu qui passe dessous. Une carte courte tient sans scroll (#27) ; une carte
  // longue défile sous les barres, qui restent en place.
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar
        extra={status === 'reviewing' && (
          <Progressbar
            className="mt-2"
            progress={session.progress}
            colors={{ trackBgIos: 'bg-black/6 dark:bg-white/15', activeBgIos: 'bg-primary dark:bg-new' }}
          />
        )}
      >
        {onBack && <BackButton onClick={onBack} />}
        <BarTitle title={title} sync={sync} />
        {status === 'reviewing' && <Counters counts={session.counts} />}
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
          <DoneScreen stats={session.stats} nextDueAt={session.nextDueAt} now={now()} onRestart={session.reviewAll} onHome={onBack} />
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
