import { Block, Button, Navbar, Page, Preloader, Progressbar } from 'konsta/react'
import { CardView } from './CardView'
import { DoneScreen } from './DoneScreen'
import { RatingBar } from './RatingBar'
import { useReviewKeys } from './useReviewKeys'
import type { ReviewSession } from './useReviewSession'

interface Props {
  session: ReviewSession
  now: () => Date
}

function Counters({ counts }: Pick<ReviewSession, 'counts'>) {
  const pills = [
    { n: counts.new, label: 'nouvelles', cls: 'bg-sys-blue/15 text-sys-blue' },
    { n: counts.learn, label: 'à revoir', cls: 'bg-sys-red/15 text-sys-red' },
    { n: counts.due, label: 'dues', cls: 'bg-sys-green/15 text-sys-green' },
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

export function ReviewScreen({ session, now }: Props) {
  useReviewKeys(session)
  const { status, current, revealed } = session

  return (
    <Page className="flex flex-col">
      <Navbar title="Vault Cards" right={status === 'reviewing' && <Counters counts={session.counts} />} />
      {status === 'reviewing' && <Progressbar className="mx-4 my-2 w-auto" progress={session.progress} />}

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center">
        {status === 'loading' && <div className="flex justify-center"><Preloader /></div>}
        {status === 'empty' && (
          <Block className="text-center text-[17px] text-sys-gray">
            Aucune carte pour l'instant. Lance /flashcards sur le Mac.
          </Block>
        )}
        {status === 'done' && (
          <DoneScreen stats={session.stats} nextDueAt={session.nextDueAt} now={now()} onRestart={session.restart} />
        )}
        {current && <CardView card={current.card} revealed={revealed} onReveal={session.reveal} />}
      </main>

      {current && (
        <div className="sticky bottom-0 mx-auto w-full max-w-xl bg-ios-light-surface px-4 pt-2 dark:bg-ios-dark-surface pb-[max(16px,var(--k-safe-area-bottom))]">
          {revealed
            ? <RatingBar state={current.state} now={now()} onRate={session.rate} />
            : <Button large rounded className="min-h-14" onClick={session.reveal}>Afficher la réponse</Button>}
        </div>
      )}
    </Page>
  )
}
