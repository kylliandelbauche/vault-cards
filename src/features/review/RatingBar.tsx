import { Button } from 'konsta/react'
import type { ReactNode } from 'react'
import { formatInterval } from '../../lib/format'
import { previewDue, type FsrsCard } from '../../lib/scheduler'
import type { Rating } from '../../lib/types'

interface Props {
  state: FsrsCard
  now: Date
  onRate(r: Rating): void
}

const icon = (path: ReactNode) => (
  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0">
    {path}
  </svg>
)

/**
 * Boutons teintés : fond coloré opaque, texte noir (clair) / blanc (sombre), la couleur va dans l'icône.
 * Appui : fond un peu plus soutenu, jamais d'opacité sur le texte (≥ 4,5:1 même pressé).
 */
const BUTTONS: { rating: Rating; label: string; fill: string; tone: string; glyph: ReactNode }[] = [
  { rating: 1, label: 'Je ne sais pas', fill: 'bg-again-fill active:bg-again-fill-pressed', tone: 'text-again', glyph: icon(<path d="M4 4l8 8M12 4l-8 8" />) },
  { rating: 2, label: 'Moyen', fill: 'bg-hard-fill active:bg-hard-fill-pressed', tone: 'text-hard', glyph: icon(<path d="M3.5 8h9" />) },
  { rating: 3, label: 'Très bien', fill: 'bg-good-fill active:bg-good-fill-pressed', tone: 'text-good', glyph: icon(<path d="M3 8.5l3.2 3L13 4.5" />) },
]

export function RatingBar({ state, now, onRate }: Props) {
  const due = previewDue(state, now)
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {BUTTONS.map(({ rating, label, fill, tone, glyph }) => (
        <Button
          key={rating}
          large
          colors={{ fillBgIos: fill, fillTextIos: 'text-black dark:text-white' }}
          className="h-auto! min-h-14 flex-col gap-0.5 rounded-[22px]! px-0.5! py-1.5 text-[15px]! leading-tight"
          onClick={() => onRate(rating)}
        >
          <span>{label}</span>
          <span className="inline-flex items-center gap-1 text-[13px] font-normal tabular-nums">
            <span className={tone}>{glyph}</span>
            {formatInterval(now, due[rating])}
          </span>
        </Button>
      ))}
    </div>
  )
}
