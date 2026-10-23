import { GlassButton } from '../../components/GlassButton'
import type { VaultDB } from '../../lib/db'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import { drafts as draftsLabel } from './sourceName'
import { SourceIcon, SourceMessage, type SourceKind } from './sources'
import { useSources, VOICE_LABEL } from './useSources'
import { useDrafts } from './useDrafts'

interface Props {
  db: VaultDB
  deps: InboxDeps
  /** Tuile « À la main » : fenêtre Nouvelle carte. */
  onManual(): void
  /** Tuile « Texte » : écran Source · Texte. */
  onText(): void
  /** Fichier ou photo envoyé : écran Brouillons de la source. */
  onSent(item: InboxItem): void
  /** Ligne « n brouillons à valider » : tous les brouillons en attente. */
  onOpenDrafts(): void
  /** « › » du titre (#86) : l'écran « Nouvelles cartes » (hub). */
  onOpenHub(): void
}

const TILE = 'on-glass tag-chip flex h-[84px] w-[87px] flex-col items-center justify-center gap-2 rounded-[20px] text-[13px] leading-4 font-medium'

/**
 * Bloc « Nouvelles cartes » de l'accueil (#81, Paper « Accueil · v4 ») : rangée défilante de 5 tuiles (À la main → Nouvelle carte) en verre neutre posées sur la carte
 * (`on-glass`, pas de flou imbriqué). Fichier et Photo : sélecteur natif puis envoi direct (inbox.ts), puis écran
 * Brouillons ; Texte : écran Source · Texte ; Vocal : pas encore (#48), un message le dit (actions : `useSources`,
 * partagées avec le hub). La ligne du titre (« › », ≥ 44 px) ouvre le hub (#86). Sous les tuiles, quand des
 * brouillons attendent : une ligne discrète qui y mène.
 */
export function NewCardsBlock({ db, deps, onManual, onText, onSent, onOpenDrafts, onOpenHub }: Props) {
  const { busy, message, actions, label, inputs } = useSources({ deps, onManual, onText, onSent })
  const { drafts } = useDrafts(db)
  const waiting = drafts?.length ?? 0

  const tile = (kind: Exclude<SourceKind, 'voice'>, text: string) => (
    <li className="shrink-0">
      <GlassButton
        tone="neutral"
        className={TILE}
        aria-busy={busy === kind || undefined}
        disabled={busy !== null}
        onClick={actions[kind]}
      >
        <SourceIcon kind={kind} className="size-[26px]" /><span>{label(kind, text)}</span>
      </GlassButton>
    </li>
  )

  return (
    <section aria-labelledby="new-cards" className="glass-card rounded-[28px] pt-3.5 pb-3 text-black dark:text-white">
      {/* Le bouton recouvre la ligne entière (titre + chevron) sans entrer dans le titre : le nom du titre reste « Nouvelles cartes ». */}
      <div className="relative mx-[18px] flex min-h-11 items-center justify-between">
        <h2 id="new-cards" className="text-[20px] leading-6 font-semibold">Nouvelles cartes</h2>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-label-2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <button type="button" aria-label="Toutes les sources" onClick={onOpenHub} className="tag-head absolute -inset-x-2 inset-y-0 rounded-2xl" />
      </div>
      {/* Rangée défilante (Accueil · v4), comme les tags : les tuiles glissent jusqu'au bord de la carte. */}
      <ul role="list" aria-label="Ajouter des cartes" className="chip-row mt-1.5 flex gap-2.5 scroll-px-[18px] px-[18px] py-1">
        {tile('manual', 'À la main')}
        {tile('file', 'Fichier')}
        {tile('photo', 'Photo')}
        {tile('text', 'Texte')}
        <li className="shrink-0">
          <GlassButton tone="neutral" className={`${TILE} tag-chip-empty`} aria-disabled="true" aria-label={VOICE_LABEL} onClick={actions.voice}>
            <SourceIcon kind="voice" className="size-[26px]" /><span>Vocal</span>
          </GlassButton>
        </li>
      </ul>
      {inputs}
      <SourceMessage message={message} className="mx-[18px] mt-2" />
      {waiting > 0 && (
        <button
          type="button"
          onClick={onOpenDrafts}
          className="tag-head mx-[14px] mt-1 flex min-h-11 w-[calc(100%-28px)] items-center justify-between rounded-2xl px-1 text-start text-[15px] leading-5 font-medium"
        >
          <span>{draftsLabel(waiting)} à valider</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-label-2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </section>
  )
}
