import { Block, Button, Navbar, Page, Preloader, Progressbar } from 'konsta/react'
import { CardView } from './CardView'
import { DoneScreen } from './DoneScreen'
import { RatingBar } from './RatingBar'
import { useReviewKeys } from './useReviewKeys'
import type { ReviewSession } from './useReviewSession'

interface Props {
  session: ReviewSession
  now: () => Date
  /** Des reviews attendent encore d'être poussées vers Supabase. */
  unsynced?: boolean
  onSignOut?(): void
}

function Counters({ counts }: Pick<ReviewSession, 'counts'>) {
  const pills = [
    { n: counts.new, label: 'nouvelles', cls: 'bg-new-tint text-new' },
    { n: counts.learn, label: 'à revoir', cls: 'bg-again-tint text-again' },
    { n: counts.due, label: 'dues', cls: 'bg-good-tint text-good' },
  ]
  return (
    <div className="flex gap-1.5 pe-2">
      {pills.map(p => (
        <span
          key={p.label}
          title={p.label}
          aria-label={`${p.n} ${p.label}`}
          className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[13px] font-semibold tabular-nums ${p.cls}`}
        >
          {p.n}
        </span>
      ))}
    </div>
  )
}

function UnsyncedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-normal text-sys-gray">
      <span aria-hidden className="size-2 rounded-full bg-sys-gray" />
      non synchronisé
    </span>
  )
}

export function ReviewScreen({ session, now, unsynced = false, onSignOut }: Props) {
  useReviewKeys(session)
  const { status, current, revealed } = session

  return (
    <Page className="flex flex-col">
      <Navbar title="Vault Cards" subtitle={unsynced ? <UnsyncedBadge /> : undefined} right={status === 'reviewing' && <Counters counts={session.counts} />} />
      {status === 'reviewing' && <Progressbar className="mx-4 my-2 w-auto" progress={session.progress} />}

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
        {status === 'loading' && <div className="flex justify-center"><Preloader /></div>}
        {status === 'error' && (
          <Block className="flex flex-col items-center gap-4 text-center">
            <p role="alert" className="text-[17px] text-sys-gray">Impossible de lire les cartes enregistrées sur cet appareil.</p>
            <Button large rounded className="max-w-xs" onClick={session.restart}>Réessayer</Button>
          </Block>
        )}
        {status === 'empty' && (
          <Block className="text-center text-[17px] text-sys-gray">
            {navigator.onLine === false
              ? 'Connecte-toi à internet pour la première synchronisation.'
              : "Aucune carte pour l'instant. Lance /flashcards sur le Mac."}
          </Block>
        )}
        {status === 'done' && (
          <DoneScreen stats={session.stats} nextDueAt={session.nextDueAt} now={now()} onRestart={session.restart} onSignOut={onSignOut} />
        )}
        {current && <CardView card={current.card} revealed={revealed} onReveal={session.reveal} />}
      </main>

      {current && (
        <div className="sticky bottom-0 mx-auto w-full max-w-xl bg-ios-light-surface px-4 pt-2 dark:bg-ios-dark-surface pb-[max(16px,var(--k-safe-area-bottom))]">
          {session.saveFailed && (
            <p role="alert" className="pb-2 text-center text-[15px] text-again">Note non enregistrée. Réessaie.</p>
          )}
          {revealed
            ? <RatingBar state={current.state} now={now()} onRate={session.rate} />
            : <Button large rounded className="min-h-14" onClick={session.reveal}>Afficher la réponse</Button>}
        </div>
      )}
    </Page>
  )
}
