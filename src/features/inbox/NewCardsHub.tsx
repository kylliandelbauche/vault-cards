import { Page } from 'konsta/react'
import { GlassButton } from '../../components/GlassButton'
import { BarTitle, EDGES, TopBar } from '../../components/TopBar'
import type { Creations, LastGeneration } from '../../lib/creations'
import type { VaultDB } from '../../lib/db'
import { formatAgo } from '../../lib/format'
import { cards } from '../../lib/home'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { drafts as draftsLabel } from './sourceName'
import { SourceIcon, SourceMessage, type SourceKind } from './sources'
import { useSources, VOICE_LABEL } from './useSources'
import { useCreations } from './useCreations'

interface Props {
  db: VaultDB
  deps: InboxDeps
  now(): Date
  onBack(): void
  /** Mêmes actions que la rangée de l'accueil (#81). */
  onManual(): void
  onText(): void
  onSent(item: InboxItem): void
  /** Dernière génération : ses brouillons s'il en reste, sinon « Mes cartes » filtré sur ce document. */
  onOpenGeneration(last: LastGeneration): void
}

const TILE = 'on-glass tag-chip flex rounded-[22px] px-[18px] text-start'
const CAPTION = 'text-[13px] leading-4 text-label-2'

const CAPTIONS: Record<Exclude<SourceKind, 'manual'>, string> = {
  file: 'PDF ou image',
  photo: 'Prendre une photo',
  text: 'Coller un texte',
  voice: 'Bientôt',
}
const TITLES: Record<SourceKind, string> = { manual: 'À la main', file: 'Fichier', photo: 'Photo', text: 'Texte', voice: 'Vocal' }

/**
 * Écran « Nouvelles cartes » (#86, Paper « Nouvelles cartes (hub) »), ouvert par le « › » du bloc de l'accueil : les
 * 5 sources (« À la main » pleine largeur, puis Fichier, Photo, Texte, Vocal en grille 2×2), puis « Tes créations »
 * calculé sur le cache local. Les sources sont celles de l'accueil (`useSources`) : mêmes actions, mêmes messages.
 * Verre imité (`on-glass`) sur le fond ; une seule surface floutée, la carte « Tes créations ». Vocal (#48) est grisé
 * et dit « Bientôt ». Aucun bouton bleu : un seul bleu d'action dans l'app, celui de l'accueil.
 */
export function NewCardsHub({ db, deps, now, onBack, onManual, onText, onSent, onOpenGeneration }: Props) {
  const { busy, message, actions, label, inputs } = useSources({ deps, onManual, onText, onSent })
  const creations = useCreations(db, now)

  const tile = (kind: Exclude<SourceKind, 'voice'>) => (
    <GlassButton
      tone="neutral"
      className={kind === 'manual' ? `${TILE} h-[76px] w-full items-center gap-3.5` : `${TILE} h-[104px] flex-col items-start justify-between py-4`}
      aria-busy={busy === kind || undefined}
      disabled={busy !== null}
      onClick={actions[kind]}
    >
      <SourceIcon kind={kind} className="size-7 shrink-0" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[17px] leading-[22px] font-semibold">{label(kind, TITLES[kind])}</span>
        <span className={CAPTION}>{kind === 'manual' ? 'Question, réponse, tags' : CAPTIONS[kind]}</span>
      </span>
    </GlassButton>
  )

  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar onBack={onBack} backLabel="Accueil">
        <BarTitle title="Nouvelles cartes" subtitle="Choisis comment créer" heading />
      </TopBar>
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 pt-1 pb-6 ${EDGES}`}>
        <section aria-label="Sources" className="flex flex-col gap-2.5">
          {tile('manual')}
          <div className="grid grid-cols-2 gap-2.5">
            {tile('file')}
            {tile('photo')}
            {tile('text')}
            <GlassButton tone="neutral" className={`${TILE} tag-chip-empty h-[104px] flex-col items-start justify-between py-4`} aria-disabled="true" aria-label={VOICE_LABEL} onClick={actions.voice}>
              <SourceIcon kind="voice" className="size-7 shrink-0" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[17px] leading-[22px] font-semibold">{TITLES.voice}</span>
                <span className="text-[13px] leading-4">{CAPTIONS.voice}</span>
              </span>
            </GlassButton>
          </div>
          <SourceMessage message={message} className="px-1" />
        </section>
        {inputs}
        {creations && <Creation creations={creations} now={now()} onOpenGeneration={onOpenGeneration} />}
      </main>
    </Page>
  )
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col-reverse items-center rounded-[18px] bg-black/4 px-1 py-3 dark:bg-white/7">
      <dt className="text-[13px] leading-4 font-medium text-label-2">{label}</dt>
      <dd className="text-[28px] leading-[34px] font-bold tabular-nums">{value}</dd>
    </div>
  )
}

/** « Tes créations » : deux compteurs, puis la dernière génération (ou un état vide sobre). */
function Creation({ creations, now, onOpenGeneration }: { creations: Creations; now: Date; onOpenGeneration(last: LastGeneration): void }) {
  const { total, thisMonth, last } = creations
  return (
    <section aria-labelledby="creations" className="flex flex-col gap-2">
      <h2 id="creations" className="px-1 text-[13px] leading-4 font-semibold tracking-[0.06em] text-label-2 uppercase">Tes créations</h2>
      <div className="glass-card flex flex-col gap-3.5 rounded-[28px] p-4 text-black dark:text-white">
        <dl className="grid grid-cols-2 gap-2">
          <Counter label="Cartes créées" value={total} />
          <Counter label="Ce mois-ci" value={thisMonth} />
        </dl>
        <div className="h-px bg-black/10 dark:bg-white/12" />
        {last
          ? (
            <button
              type="button"
              onClick={() => onOpenGeneration(last)}
              className="tag-head -m-1 flex min-h-14 items-center gap-3 rounded-2xl p-1 text-start"
            >
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-black/4 dark:bg-white/7">
                <SourceIcon kind="file" className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={CAPTION}>Dernière génération · {formatAgo(new Date(last.at), now)}</span>
                <span className="truncate text-[17px] leading-[22px] font-semibold">
                  {last.title} · {cards(last.count)}
                  {last.drafts > 0 && <span className="sr-only">, {draftsLabel(last.drafts)} à valider</span>}
                </span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0 text-label-2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          )
          : <p className="text-[15px] leading-5 text-label-2">Aucune génération pour l’instant. Envoie un fichier, une photo ou un texte.</p>}
      </div>
    </section>
  )
}
