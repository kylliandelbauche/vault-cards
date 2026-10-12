import { Card } from 'konsta/react'
import { obsidianUrl } from '../../lib/obsidian'
import type { Card as CardData } from '../../lib/types'

interface Props {
  card: CardData
  revealed: boolean
  onReveal(): void
}

export function CardView({ card, revealed, onReveal }: Props) {
  return (
    <Card
      raised
      className={revealed ? '' : 'cursor-pointer'}
      contentWrapPadding="p-5"
      onClick={onReveal}
    >
      <a
        href={obsidianUrl(card.source_path)}
        onClick={e => e.stopPropagation()}
        className="block truncate font-mono text-xs text-sys-gray underline-offset-2 hover:underline"
      >
        {card.source_path}
      </a>
      <p className="mt-3 whitespace-pre-wrap text-[22px] leading-snug font-semibold">{card.front}</p>
      {revealed && (
        <>
          <hr className="my-4 border-black/10 dark:border-white/15" />
          <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{card.back}</p>
        </>
      )}
    </Card>
  )
}
