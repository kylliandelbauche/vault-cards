import { GlassButton } from '../../components/GlassButton'
import { cards, type TagCount } from '../../lib/home'
import { tagColorVars } from '../../lib/tagColor'

interface Props {
  tag: TagCount
  onStudy(slug: string): void
  /** `grid` : pastille de l'accueil (nombre de cartes) ; `row` : ligne de la page « Mes tags » (+ à revoir aujourd'hui). */
  variant: 'grid' | 'row'
}

/**
 * Pastille d'un tag, reconnaissable à sa couleur (#53) : verre translucide teinté de la couleur du tag, liseré
 * et reflet Liquid Glass, texte dans la couleur du tag (foncée en clair, claire en sombre). Libellé seul, pas
 * d'icône. Posée sur une carte en verre → `on-glass` : aucun backdrop-filter (pas de flou imbriqué).
 * Cible ≥ 44 px ; tap → session du tag. Tag sans carte : verre neutre, texte gris, non cliquable
 * (`aria-disabled`, reste lisible et atteignable au clavier).
 */
export function TagChip({ tag: t, onStudy, variant }: Props) {
  const empty = t.count === 0
  const detail = variant === 'row' && !empty ? `${t.today} à revoir aujourd'hui` : null
  const style = empty ? undefined : tagColorVars(t.color)
  return (
    <GlassButton
      tone="neutral"
      aria-disabled={empty || undefined}
      aria-label={`${t.label}, ${cards(t.count)}${detail ? `, ${detail}` : ''}`}
      onClick={empty ? undefined : () => onStudy(t.slug)}
      style={style}
      className={`on-glass tag-chip ${empty ? 'tag-chip-empty' : ''} flex h-full w-full items-center gap-2 rounded-2xl px-3 text-start ${variant === 'row' ? 'min-h-13 py-2' : 'min-h-12 py-1.5'}`}
    >
      <span className="min-w-0 flex-1 text-[14px] leading-tight font-medium">{t.label}</span>
      <span className="flex shrink-0 flex-col items-end">
        <span className="text-[14px] leading-tight font-semibold tabular-nums">{variant === 'row' ? cards(t.count) : t.count}</span>
        {detail && <span className="text-[12px] leading-tight tabular-nums">{detail}</span>}
      </span>
    </GlassButton>
  )
}
