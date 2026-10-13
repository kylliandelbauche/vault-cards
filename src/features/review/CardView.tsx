import { Card } from 'konsta/react'
import { obsidianUrl } from '../../lib/obsidian'
import type { Card as CardData } from '../../lib/types'
import { getTag, type TagDef } from '../../../shared/tags'

interface Props {
  card: CardData
  revealed: boolean
  onReveal(): void
}

export function CardView({ card, revealed, onReveal }: Props) {
  return (
    <Card
      raised
      className={revealed ? 'my-auto shrink-0' : 'my-auto shrink-0 cursor-pointer'}
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
      <TagPills slugs={card.tags} />
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

/** Pastilles emoji + label. Tag inconnu (liste locale plus ancienne que la base) : ignoré. Doublon : affiché une fois. */
function TagPills({ slugs }: { slugs: readonly string[] | null | undefined }) {
  const tags = [...new Set(slugs ?? [])].map(getTag).filter((t): t is TagDef => t !== undefined)
  if (tags.length === 0) return null
  return (
    // role="list" : sans puces (preflight Tailwind), Safari/VoiceOver retire sinon la sémantique de liste.
    <ul role="list" className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map(t => (
        <li
          key={t.slug}
          className="rounded-full px-2 py-0.5 text-xs leading-5 font-medium"
          style={{ backgroundColor: `var(--tag-${t.color}-bg)`, color: `var(--tag-${t.color}-fg)` }}
        >
          <span aria-hidden="true">{t.emoji}</span> {t.label}
        </li>
      ))}
    </ul>
  )
}
