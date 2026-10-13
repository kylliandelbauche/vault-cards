import { Button, Page, Preloader, Progressbar } from 'konsta/react'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { CardView } from './CardView'
import { DoneScreen } from './DoneScreen'
import { RatingBar } from './RatingBar'
import { useReviewKeys } from './useReviewKeys'
import type { SyncIndicator } from './useAutoSync'
import type { ReviewSession } from './useReviewSession'

interface Props {
  session: ReviewSession
  now: () => Date
  /** État de la synchro, affiché sous le titre. */
  sync?: SyncIndicator
  onSignOut?(): void
}

/** Marges latérales : 12 px, ou la zone sûre en paysage (encoche, Dynamic Island). */
const EDGES = 'ps-[max(12px,var(--k-safe-area-left))] pe-[max(12px,var(--k-safe-area-right))]'

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

const SYNC_BADGE: Record<SyncIndicator, { label: string; dot: string }> = {
  synced: { label: 'Synchronisé', dot: 'bg-good' },
  unsynced: { label: 'Non synchronisé', dot: 'bg-muted' },
  syncing: { label: 'Synchronisation…', dot: 'bg-muted motion-safe:animate-pulse' },
}

/**
 * Point de couleur + libellé (jamais la couleur seule). Sur le verre, le texte reste neutre et opaque
 * (pas de couleur sémantique ni d'opacité) : ≥ 4,5:1 en clair comme en sombre, quel que soit le contenu dessous.
 */
function SyncBadge({ sync }: { sync: SyncIndicator }) {
  const { label, dot } = SYNC_BADGE[sync]
  return (
    <span role="status" className="flex items-center gap-1.5 text-[13px] leading-4 text-label-2">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

/** Icône seule, cible 44 px ; marges négatives pour ne pas agrandir la barre (la page doit tenir sans scroll). */
function SignOutButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      aria-label="Déconnexion"
      onClick={onClick}
      className="-my-2 -me-2 flex size-11 shrink-0 items-center justify-center rounded-full text-label-2 active:bg-black/5 dark:active:bg-white/10"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5" />
        <path d="M21 12H9" />
      </svg>
    </button>
  )
}

export function ReviewScreen({ session, now, sync, onSignOut }: Props) {
  useReviewKeys(session)
  const { status, current, revealed } = session

  // La page entière est le conteneur de défilement ; les barres en verre sont `sticky` et se
  // superposent au contenu qui passe dessous. Une carte courte tient sans scroll (#27) ; une carte
  // longue défile sous les barres, qui restent en place.
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <header className={`sticky top-0 z-20 shrink-0 pt-[max(12px,var(--k-safe-area-top))] pb-2 ${EDGES}`}>
        <div className="glass mx-auto max-w-xl rounded-[26px] px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] leading-tight font-semibold text-black dark:text-white">Vault Cards</p>
              {sync && <SyncBadge sync={sync} />}
            </div>
            {status === 'reviewing' && <Counters counts={session.counts} />}
            {onSignOut && <SignOutButton onClick={onSignOut} />}
          </div>
          {status === 'reviewing' && (
            <Progressbar
              className="mt-2"
              progress={session.progress}
              colors={{ trackBgIos: 'bg-black/6 dark:bg-white/15', activeBgIos: 'bg-primary dark:bg-new' }}
            />
          )}
        </div>
      </header>

      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col py-2 ${EDGES}`}>
        {status === 'loading' && <div className="my-auto flex justify-center"><Preloader /></div>}
        {status === 'error' && (
          <div className="card-surface my-auto flex flex-col items-center gap-4 rounded-[28px] p-6 text-center">
            <p role="alert" className="text-[17px] text-muted">Impossible de lire les cartes enregistrées sur cet appareil.</p>
            <Button large rounded className="max-w-xs" onClick={session.restart}>Réessayer</Button>
          </div>
        )}
        {status === 'empty' && (
          <p className="card-surface my-auto rounded-[28px] p-6 text-center text-[17px] text-muted">
            {navigator.onLine === false
              ? 'Connecte-toi à internet pour la première synchronisation.'
              : "Aucune carte pour l'instant. Lance /flashcards sur le Mac."}
          </p>
        )}
        {status === 'done' && (
          <DoneScreen stats={session.stats} nextDueAt={session.nextDueAt} now={now()} onRestart={session.reviewAll} onSignOut={onSignOut} />
        )}
        {current && <CardView card={current.card} revealed={revealed} onReveal={session.reveal} />}
      </main>

      {current && (
        <footer className={`sticky bottom-0 z-20 shrink-0 pt-2 pb-[max(12px,var(--k-safe-area-bottom))] ${EDGES}`}>
          <div className="glass mx-auto max-w-xl rounded-[30px] p-2">
            {session.saveFailed && (
              <p role="alert" className="mx-auto mb-2 w-fit rounded-full bg-again-tint px-3 py-1 text-center text-[15px] text-again">
                Note non enregistrée. Réessaie.
              </p>
            )}
            {/* Un seul emplacement d'action, sous le pouce : « Afficher la réponse », puis la notation. */}
            <div role="group" aria-label="Actions">
              {revealed
                ? <RatingBar state={current.state} now={now()} onRate={session.rate} />
                : <Button large rounded className="h-14!" onClick={session.reveal}>Afficher la réponse</Button>}
            </div>
          </div>
        </footer>
      )}
    </Page>
  )
}
