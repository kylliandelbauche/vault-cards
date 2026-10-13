import { cards, type TagCount } from '../../lib/home'

interface Props {
  tag: TagCount
  onStudy(slug: string): void
  /** `grid` : pastille de l'accueil (nombre de cartes) ; `row` : ligne de la page « Mes tags » (+ à revoir aujourd'hui). */
  variant: 'grid' | 'row'
}

/**
 * Pastille d'un tag, cible ≥ 44 px ; tap → session du tag. Tag sans carte : grisé, non cliquable
 * (`aria-disabled`, reste lisible et atteignable au clavier).
 */
export function TagChip({ tag: t, onStudy, variant }: Props) {
  const empty = t.count === 0
  const detail = variant === 'row' && !empty ? `${t.today} à revoir aujourd'hui` : null
  return (
    <button
      type="button"
      aria-disabled={empty || undefined}
      aria-label={`${t.label}, ${cards(t.count)}${detail ? `, ${detail}` : ''}`}
      onClick={empty ? undefined : () => onStudy(t.slug)}
      className={`tag-btn flex h-full w-full items-center gap-2 rounded-2xl px-3 text-start ${variant === 'row' ? 'min-h-13 py-2' : 'min-h-11 py-1.5'} ${empty ? 'tag-btn-empty' : ''}`}
      style={empty ? undefined : { backgroundColor: `var(--tag-${t.color}-bg)`, color: `var(--tag-${t.color}-fg)` }}
    >
      <span aria-hidden="true" className={`text-[17px] leading-none ${empty ? 'grayscale' : ''}`}>{t.emoji}</span>
      <span className="min-w-0 flex-1 text-[14px] leading-tight font-medium">{t.label}</span>
      <span className="flex flex-col items-end">
        <span className="text-[14px] leading-tight font-semibold tabular-nums">{variant === 'row' ? cards(t.count) : t.count}</span>
        {detail && <span className="text-[12px] leading-tight tabular-nums">{detail}</span>}
      </span>
    </button>
  )
}
