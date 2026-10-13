import type { Card as CardData } from '../../lib/types'
import { humanizeFileName } from '../../../shared/source-title'
import { getTag, type TagDef } from '../../../shared/tags'

interface Props {
  card: CardData
  revealed: boolean
  onReveal(): void
}

/**
 * Carte en verre (#40) : même matériau que les barres, teint plus opaque pour le texte. Toute la carte révèle la réponse.
 * Titre de la source sur une ligne tronquée ; sans titre (cache d'avant #35), nom de fichier humanisé. Jamais le chemin local.
 */
export function CardView({ card, revealed, onReveal }: Props) {
  const title = card.source_title?.trim() || humanizeFileName(card.source_path)
  return (
    <article
      className={`glass-card my-auto shrink-0 rounded-[28px] p-5 text-black dark:text-white ${revealed ? '' : 'cursor-pointer'}`}
      onClick={onReveal}
    >
      <p className="truncate text-xs text-muted">{title}</p>
      <TagPills slugs={card.tags} />
      <p className="mt-3 whitespace-pre-wrap text-[22px] leading-snug font-semibold">{card.front}</p>
      {revealed && (
        <>
          <hr className="my-4 border-black/10 dark:border-white/15" />
          <p className="whitespace-pre-wrap text-[17px] leading-relaxed">{card.back}</p>
        </>
      )}
    </article>
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
