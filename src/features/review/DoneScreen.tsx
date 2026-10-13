import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { formatInterval } from '../../lib/format'

interface Props {
  stats: { again: number; hard: number; good: number }
  nextDueAt: Date | null
  now: Date
  onRestart(): void
  /** Retour à l'accueil. */
  onHome?(): void
}

/**
 * Même langage que la révision (#39) : bilan sur une carte en verre, boutons en verre indépendants dessous
 * (jamais dans la carte : pas de flou imbriqué). Chiffres en noir / blanc, la couleur va dans le symbole
 * (sur le verre de la carte, une couleur de note en texte passerait sous 4,5:1 en sombre).
 */
export function DoneScreen({ stats, nextDueAt, now, onRestart, onHome }: Props) {
  return (
    <div className="my-auto flex flex-col items-center gap-4">
      <section className="glass-card flex w-full flex-col items-center gap-6 rounded-[28px] px-5 py-8 text-center text-black dark:text-white">
        <h1 className="text-[28px] font-bold">Session terminée</h1>
        <div className="flex gap-6 text-[20px] font-semibold tabular-nums">
          <span aria-label={`${stats.again} « Je ne sais pas »`}><span className="text-again">✕</span> {stats.again}</span>
          <span aria-label={`${stats.hard} « Moyen »`}><span className="text-hard">~</span> {stats.hard}</span>
          <span aria-label={`${stats.good} « Très bien »`}><span className="text-good">✓</span> {stats.good}</span>
        </div>
        <p className="text-[17px] text-label-2">
          {nextDueAt ? `Prochaine révision dans ${formatInterval(now, nextDueAt)}` : 'Aucune carte en attente.'}
        </p>
      </section>
      <GlassButton tone="new" className={`${GLASS_PRIMARY} max-w-xs`} onClick={onRestart}>Réviser à nouveau</GlassButton>
      {onHome && (
        <GlassButton tone="neutral" className="min-h-11 rounded-full px-5 text-[15px] font-medium" onClick={onHome}>
          Retour à l'accueil
        </GlassButton>
      )}
    </div>
  )
}
