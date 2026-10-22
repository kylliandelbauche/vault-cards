import type { Card as CardData } from '../../lib/types'
import { humanizeFileName } from '../../../shared/source-title'
import { tagKey } from '../../../shared/tags'

/** Ligne de titre d'une carte créée à la main (#54), qui n'a pas de note source. Libellé provisoire, à remplacer par la maquette. */
export const MANUAL_CARD_LABEL = 'Carte perso'

interface Props {
  card: CardData
  revealed: boolean
  onReveal(): void
  /** Bouton ⋯ (#73, Paper « Révision · Menu de la carte ») : ouvre le menu sous le bouton. Absent : pas de bouton. */
  onMenu?(button: HTMLButtonElement): void
  menuOpen?: boolean
}

/**
 * Carte en verre (#40) : même matériau que les barres, teint plus opaque pour le texte. Toute la carte révèle la réponse.
 * Ancrée en haut (pas centrée) : en dévoilant la réponse, la carte ne grandit que vers le bas et la question ne bouge pas (#42).
 * Titre de la source sur une ligne tronquée ; sans titre (cache d'avant #35), nom de fichier humanisé. Jamais le chemin local.
 */
export function CardView({ card, revealed, onReveal, onMenu, menuOpen = false }: Props) {
  const title = card.source_title?.trim() || (card.source_path ? humanizeFileName(card.source_path) : MANUAL_CARD_LABEL)
  return (
    <article
      className={`glass-card mt-[6dvh] shrink-0 rounded-[28px] px-5 pb-5 ${onMenu ? 'pt-3.5' : 'pt-5'} text-black dark:text-white ${revealed ? '' : 'cursor-pointer'}`}
      onClick={onReveal}
    >
      {onMenu ? (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-xs text-muted">{title}</p>
          <MenuButton open={menuOpen} onOpen={onMenu} />
        </div>
      ) : <p className="truncate text-xs text-muted">{title}</p>}
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

/**
 * ⋯ rond de 32 px (Paper) dans une cible de 44 px (marges négatives : la ligne garde 32 px de haut). Posé sur la carte
 * en verre : fond translucide sans flou (pas de flou imbriqué). Ni le tap ni Entrée / Espace ne révèlent la carte.
 */
function MenuButton({ open, onOpen }: { open: boolean; onOpen(button: HTMLButtonElement): void }) {
  return (
    <button
      type="button"
      aria-label="Actions de la carte"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={e => { e.stopPropagation(); onOpen(e.currentTarget) }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
      className="group -my-1.5 -me-1.5 flex size-11 shrink-0 items-center justify-center rounded-full outline-none"
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-black/8 text-black shadow-[inset_0_0_0_0.5px_var(--glass-edge)] group-hover:bg-black/14 group-focus-visible:outline-2 group-focus-visible:outline-new group-active:bg-black/20 dark:bg-white/22 dark:text-white dark:group-hover:bg-white/30 dark:group-active:bg-white/36">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="currentColor">
          <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
        </svg>
      </span>
    </button>
  )
}
