import type { ReactNode } from 'react'
import { GlassButton, type GlassTone } from '../../components/GlassButton'
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
 * Trois boutons en verre coloré indépendants (#39) : rouge, ambre, vert. Icône, libellé et intervalle en
 * blanc (≥ 4,5:1 sur le verre teinté, même pressé) ; la couleur est dans le verre, la forme dans l'icône.
 */
const BUTTONS: { rating: Rating; label: string; tone: GlassTone; glyph: ReactNode }[] = [
  { rating: 1, label: 'Je ne sais pas', tone: 'again', glyph: icon(<path d="M4 4l8 8M12 4l-8 8" />) },
  { rating: 2, label: 'Moyen', tone: 'hard', glyph: icon(<path d="M3.5 8h9" />) },
  { rating: 3, label: 'Très bien', tone: 'good', glyph: icon(<path d="M3 8.5l3.2 3L13 4.5" />) },
]

export function RatingBar({ state, now, onRate }: Props) {
  const due = previewDue(state, now)
  return (
    <div className="grid grid-cols-3 gap-2">
      {BUTTONS.map(({ rating, label, tone, glyph }) => (
        <GlassButton
          key={rating}
          tone={tone}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-[22px] px-0.5 py-1.5 text-[15px] leading-tight font-semibold"
          onClick={() => onRate(rating)}
        >
          <span>{label}</span>
          <span className="inline-flex items-center gap-1 text-[13px] font-normal tabular-nums">
            {glyph}
            {formatInterval(now, due[rating])}
          </span>
        </GlassButton>
      ))}
    </div>
  )
}
