import { obsidianUrl } from '../../lib/obsidian'
import type { Card as CardData } from '../../lib/types'
import { getTag, type TagDef } from '../../../shared/tags'

interface Props {
  card: CardData
  revealed: boolean
  onReveal(): void
}

/**
 * Carte = contenu : surface givrée dense, sans verre. Le lien Obsidian a sa propre ligne (zone de tap
 * de 44 px), séparée par un trait de la zone qui révèle la réponse : un tap en haut de la carte
 * n'ouvre plus Obsidian par erreur.
 */
export function CardView({ card, revealed, onReveal }: Props) {
  return (
    <article className="card-surface my-auto shrink-0 rounded-[28px] text-black dark:text-white">
      <div className="flex border-b border-black/8 px-5 dark:border-white/10">
        <a
          href={obsidianUrl(card.source_path)}
          className="-mx-2 flex min-h-11 min-w-0 items-center rounded-lg px-2 font-mono text-[13px] text-muted underline-offset-2 hover:underline"
        >
          <span className="truncate">{card.source_path}</span>
        </a>
      </div>
      <div className={revealed ? 'px-5 pt-4 pb-5' : 'cursor-pointer px-5 pt-4 pb-5'} onClick={onReveal}>
        <TagPills slugs={card.tags} />
        <p className="whitespace-pre-wrap text-[22px] leading-snug font-semibold">{card.front}</p>
        {revealed && (
          <>
            <hr className="my-4 border-black/10 dark:border-white/15" />
            <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{card.back}</p>
          </>
        )}
      </div>
    </article>
  )
}

/** Pastilles emoji + label. Tag inconnu (liste locale plus ancienne que la base) : ignoré. Doublon : affiché une fois. */
function TagPills({ slugs }: { slugs: readonly string[] | null | undefined }) {
  const tags = [...new Set(slugs ?? [])].map(getTag).filter((t): t is TagDef => t !== undefined)
  if (tags.length === 0) return null
  return (
    // role="list" : sans puces (preflight Tailwind), Safari/VoiceOver retire sinon la sémantique de liste.
    <ul role="list" className="mb-3 flex flex-wrap gap-1.5" aria-label="Tags">
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
