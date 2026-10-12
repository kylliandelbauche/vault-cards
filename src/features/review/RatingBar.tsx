import { Button } from 'konsta/react'
import { formatInterval } from '../../lib/format'
import { previewDue, type FsrsCard } from '../../lib/scheduler'
import type { Rating } from '../../lib/types'

interface Props {
  state: FsrsCard
  now: Date
  onRate(r: Rating): void
}

const BUTTONS: { rating: Rating; label: string; bg: string }[] = [
  { rating: 1, label: 'Je ne sais pas', bg: 'bg-sys-red' },
  { rating: 2, label: 'Moyen', bg: 'bg-sys-orange' },
  { rating: 3, label: 'Très bien', bg: 'bg-sys-green' },
]

export function RatingBar({ state, now, onRate }: Props) {
  const due = previewDue(state, now)
  return (
    <div className="grid grid-cols-3 gap-2">
      {BUTTONS.map(({ rating, label, bg }) => (
        <Button
          key={rating}
          large
          colors={{ fillBgIos: `${bg} active:opacity-80`, fillTextIos: 'text-white' }}
          className="h-auto! min-h-14 flex-col rounded-2xl! px-1! py-2 text-[15px]! leading-tight"
          onClick={() => onRate(rating)}
        >
          <span>{label}</span>
          <span className="text-[13px] font-normal tabular-nums opacity-90">{formatInterval(now, due[rating])}</span>
        </Button>
      ))}
    </div>
  )
}
