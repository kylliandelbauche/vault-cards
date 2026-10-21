import type { Card as CardData } from '../../lib/types'
import { humanizeFileName } from '../../../shared/source-title'
import { tagKey } from '../../../shared/tags'

/** Ligne de titre d'une carte créée à la main (#54), qui n'a pas de note source. Libellé provisoire, à remplacer par la maquette. */
export const MANUAL_CARD_LABEL = 'Carte perso'

interface Props {
  card: CardData
  revealed: boolean
  onReveal(): void
}

/**
 * Carte en verre (#40) : même matériau que les barres, teint plus opaque pour le texte. Toute la carte révèle la réponse.
 * Ancrée en haut (pas centrée) : en dévoilant la réponse, la carte ne grandit que vers le bas et la question ne bouge pas (#42).
 * Titre de la source sur une ligne tronquée ; sans titre (cache d'avant #35), nom de fichier humanisé. Jamais le chemin local.
 */
export function CardView({ card, revealed, onReveal }: Props) {
  const title = card.source_title?.trim() || (card.source_path ? humanizeFileName(card.source_path) : MANUAL_CARD_LABEL)
  return (
    <article
      className={`glass-card mt-[6dvh] shrink-0 rounded-[28px] p-5 text-black dark:text-white ${revealed ? '' : 'cursor-pointer'}`}
      onClick={onReveal}
    >
      <p className="truncate text-xs text-muted">{title}</p>
      <TagPills names={card.tags} />
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

/** Pastilles de texte en verre neutre (nom seul : ni icône ni couleur, #63). Doublon (casse ignorée) : affiché une fois. */
function TagPills({ names }: { names: readonly string[] | null | undefined }) {
  const tags = (names ?? []).filter((n, i, all) => n.trim() !== '' && all.findIndex(m => tagKey(m) === tagKey(n)) === i)
  if (tags.length === 0) return null
  return (
    // role="list" : sans puces (preflight Tailwind), Safari/VoiceOver retire sinon la sémantique de liste.
    <ul role="list" className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags">
      {tags.map(t => (
        <li key={t} className="tag-pill rounded-full px-2 py-0.5 text-xs leading-5 font-medium">{t}</li>
      ))}
    </ul>
  )
}
