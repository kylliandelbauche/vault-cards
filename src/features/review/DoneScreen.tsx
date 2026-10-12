import { Block, Button } from 'konsta/react'
import { formatInterval } from '../../lib/format'

interface Props {
  stats: { again: number; hard: number; good: number }
  nextDueAt: Date | null
  now: Date
  onRestart(): void
  onSignOut?(): void
}

export function DoneScreen({ stats, nextDueAt, now, onRestart, onSignOut }: Props) {
  return (
    <Block className="my-auto flex flex-col items-center gap-6 text-center">
      <h1 className="text-[28px] font-bold">Session terminée</h1>
      <div className="flex gap-6 text-[20px] font-semibold tabular-nums">
        <span className="text-again" aria-label={`${stats.again} « Je ne sais pas »`}>✕ {stats.again}</span>
        <span className="text-hard" aria-label={`${stats.hard} « Moyen »`}>~ {stats.hard}</span>
        <span className="text-good" aria-label={`${stats.good} « Très bien »`}>✓ {stats.good}</span>
      </div>
      <p className="text-[17px] text-sys-gray">
        {nextDueAt ? `Prochaine révision dans ${formatInterval(now, nextDueAt)}` : 'Aucune carte en attente.'}
      </p>
      <Button large rounded className="max-w-xs" onClick={onRestart}>Réviser à nouveau</Button>
      {onSignOut && (
        <Button clear inline rounded className="mt-4 min-h-11 px-4 text-[15px]" colors={{ textIos: 'text-new' }} onClick={onSignOut}>
          Se déconnecter
        </Button>
      )}
    </Block>
  )
}
