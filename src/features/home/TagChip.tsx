import type { CSSProperties } from 'react'
import { GlassButton } from '../../components/GlassButton'
import { cards, type TagCount } from '../../lib/home'

interface Props {
  tag: TagCount
  onStudy(slug: string): void
  /** `grid` : pastille de l'accueil (nombre de cartes) ; `row` : ligne de la page « Mes tags » (+ à revoir aujourd'hui). */
  variant: 'grid' | 'row'
}

/**
 * Pastille d'un tag en verre Liquid Glass, comme les boutons de notation : verre neutre translucide, lueur et
 * liseré de la couleur du tag (`--chip`), reflet, emoji sur une petite pastille ronde opaque, libellé neutre
 * noir / blanc. Posée sur une carte en verre → `on-glass` : aucun backdrop-filter (pas de flou imbriqué).
 * Cible ≥ 44 px ; tap → session du tag. Tag sans carte : grisé, sans lueur, non cliquable (`aria-disabled`,
 * reste lisible et atteignable au clavier).
 */
export function TagChip({ tag: t, onStudy, variant }: Props) {
  const empty = t.count === 0
  const detail = variant === 'row' && !empty ? `${t.today} à revoir aujourd'hui` : null
  const style = empty ? undefined : ({ '--chip': `var(--tag-${t.color}-fg)` } as CSSProperties)
  return (
    <GlassButton
      tone="neutral"
      aria-disabled={empty || undefined}
      aria-label={`${t.label}, ${cards(t.count)}${detail ? `, ${detail}` : ''}`}
      onClick={empty ? undefined : () => onStudy(t.slug)}
      style={style}
      className={`on-glass tag-chip ${empty ? 'tag-chip-empty' : ''} flex h-full w-full items-center gap-2 rounded-2xl ps-2 pe-3 text-start ${variant === 'row' ? 'min-h-13 py-2' : 'min-h-12 py-1.5'}`}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[15px] leading-none"
        style={{ backgroundColor: empty ? 'var(--tag-empty-bg)' : `var(--tag-${t.color}-bg)` }}
      >
        <span className={empty ? 'grayscale' : ''}>{t.emoji}</span>
      </span>
      <span className="min-w-0 flex-1 text-[14px] leading-tight font-medium">{t.label}</span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-[14px] leading-tight font-semibold tabular-nums">{variant === 'row' ? cards(t.count) : t.count}</span>
        {/* Neutre comme le libellé : sur le verre teinté, un gris secondaire passerait sous 4,5:1 en sombre. */}
        {detail && <span className="text-[12px] leading-tight tabular-nums">{detail}</span>}
      </span>
    </GlassButton>
  )
}
