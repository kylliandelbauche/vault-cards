import { GlassButton } from '../../components/GlassButton'
import { cards, type TagCount } from '../../lib/home'

interface Props {
  tag: TagCount
  onStudy(slug: string): void
}

/**
 * Ligne d'un tag sur la page « Mes tags » : verre neutre comme les boutons de notation, texte neutre (noir/blanc),
 * libellé seul (ni icône ni couleur, #63), nombre de cartes et cartes à revoir aujourd'hui. Posée sur une carte
 * en verre → `on-glass` : aucun backdrop-filter (pas de flou imbriqué). Cible ≥ 44 px ; tap → session du tag.
 * Tag sans carte : sans remplissage, texte gris, non cliquable (`aria-disabled`, reste lisible et atteignable au clavier).
 */
export function TagChip({ tag: t, onStudy }: Props) {
  const empty = t.total === 0
  const detail = empty ? null : `${t.today} à revoir aujourd'hui`
  return (
    <GlassButton
      tone="neutral"
      aria-disabled={empty || undefined}
      aria-label={`${t.label}, ${cards(t.total)}${detail ? `, ${detail}` : ''}`}
      onClick={empty ? undefined : () => onStudy(t.slug)}
      className={`on-glass tag-chip ${empty ? 'tag-chip-empty' : ''} flex min-h-13 w-full items-center gap-2 rounded-2xl px-3 py-2 text-start`}
    >
      <span className="min-w-0 flex-1 text-[14px] leading-tight font-medium">{t.label}</span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-[14px] leading-tight font-semibold tabular-nums">{cards(t.total)}</span>
        {detail && <span className="text-[12px] leading-tight tabular-nums">{detail}</span>}
      </span>
    </GlassButton>
  )
}
