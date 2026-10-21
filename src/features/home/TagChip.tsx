import { GlassButton } from '../../components/GlassButton'
import { cards, type TagCount } from '../../lib/home'

interface Props {
  tag: TagCount
  onStudy(slug: string): void
}

/**
 * Pastille d'un tag sur la page « Mes tags » v3 (#82) : libellé seul (ni icône ni couleur par tag, #63), 44 px.
 * - Cartes dues : verre neutre (flou propre : posée sur le fond, aucune carte dessous) + badge bleu plein du
 *   nombre de cartes dues.
 * - À jour : pastille grise sans verre (`tag-chip-idle`, texte ≥ 4,5:1), toujours cliquable (révision libre au bout).
 * - Sans carte : contour en pointillés, non cliquable (`aria-disabled`, reste lisible et atteignable au clavier).
 */
export function TagChip({ tag: t, onStudy }: Props) {
  const empty = t.total === 0
  const due = t.today > 0
  const detail = empty ? '' : due ? `, ${t.today} à revoir` : ', à jour'
  const look = due ? '' : `on-glass ${empty ? 'tag-chip-empty' : 'tag-chip-idle'}`
  return (
    <GlassButton
      tone="neutral"
      aria-disabled={empty || undefined}
      aria-label={`${t.label}, ${cards(t.total)}${detail}`}
      onClick={empty ? undefined : () => onStudy(t.slug)}
      className={`tag-chip ${look} flex h-11 items-center gap-2.5 rounded-full ${due ? 'ps-[18px] pe-[7px]' : 'px-[18px]'} text-[15px] leading-[18px] font-medium whitespace-nowrap`}
    >
      {t.label}
      {due && (
        <span aria-hidden="true" className="due-badge flex h-[30px] min-w-[30px] items-center justify-center rounded-full px-2 text-[14px] leading-4 font-bold tabular-nums">
          {t.today}
        </span>
      )}
    </GlassButton>
  )
}
