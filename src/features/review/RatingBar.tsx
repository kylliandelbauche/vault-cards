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
  <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-4">
    {path}
  </svg>
)

/**
 * Trois boutons en verre indépendants (#39, maquette de Kyllian) : verre neutre translucide, lueur et liseré
 * de la couleur de la note. De haut en bas : pastille ronde opaque avec l'icône (✕ / – / ✓, pas de flou
 * imbriqué), libellé noir / blanc, intervalle dans la couleur de la note (version lisible ≥ 4,5:1 sur le verre).
 */
const BUTTONS: { rating: Rating; label: string; tone: GlassTone; pill: string; interval: string; glyph: ReactNode }[] = [
  { rating: 1, label: 'Je ne sais pas', tone: 'again', pill: 'bg-again-pill', interval: 'text-again-glass', glyph: icon(<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />) },
  { rating: 2, label: 'Moyen', tone: 'hard', pill: 'bg-hard-pill', interval: 'text-hard-glass', glyph: icon(<path d="M3.5 8h9" />) },
  { rating: 3, label: 'Très bien', tone: 'good', pill: 'bg-good-pill', interval: 'text-good-glass', glyph: icon(<path d="M3.5 8.5l3 3L12.5 5" />) },
]

export function RatingBar({ state, now, onRate }: Props) {
  const due = previewDue(state, now)
  return (
    <div className="grid grid-cols-3 gap-2">
      {BUTTONS.map(({ rating, label, tone, pill, interval, glyph }) => (
        <GlassButton
          key={rating}
          tone={tone}
          className="flex min-h-[76px] flex-col items-center justify-center rounded-[24px] px-0.5 py-1.5 text-[15px] leading-tight font-semibold"
          onClick={() => onRate(rating)}
        >
          <span aria-hidden="true" className={`mb-1 flex size-7 shrink-0 items-center justify-center rounded-full text-white ${pill}`}>
            {glyph}
          </span>
          <span>{label}</span>
          <span className={`text-[13px] font-semibold tabular-nums ${interval}`}>{formatInterval(now, due[rating])}</span>
        </GlassButton>
      ))}
    </div>
  )
}
