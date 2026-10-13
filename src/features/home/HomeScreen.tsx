import { Page, Preloader } from 'konsta/react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { BarTitle, EDGES, SignOutButton, TopBar, type SyncIndicator } from '../../components/TopBar'
import { formatInterval } from '../../lib/format'
import { cards, todaySuffix, type HomeStats, type TagCount } from '../../lib/home'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import type { HomeData } from './useHomeData'

interface Props {
  data: HomeData
  now: () => Date
  sync?: SyncIndicator
  /** « Commencer à étudier » (sans tag) ou tap sur un tag : session du jour. */
  onStudy(tag?: string): void
  /** « Réviser à nouveau » quand rien n'est dû : révision libre de toutes les cartes. */
  onReviewAll(): void
  onSignOut?(): void
}

/**
 * Écran d'accueil (#53). Surfaces floutées : barre du haut, carte « aujourd'hui », bouton d'action, carte
 * « Mes tags » (4, aucune imbriquée). Compteurs et pastilles de tags sont opaques, sans flou, dans les cartes.
 */
export function HomeScreen({ data, now, sync, onStudy, onReviewAll, onSignOut }: Props) {
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar>
        <BarTitle title="Vault Cards" sync={sync} />
        {onSignOut && <SignOutButton onClick={onSignOut} />}
      </TopBar>

      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 py-2 ${EDGES}`}>
        {data.status === 'loading' && <div className="my-auto flex justify-center"><Preloader /></div>}
        {data.status === 'error' && (
          <p role="alert" className="glass-card my-auto rounded-[28px] p-6 text-center text-[17px] text-label-2">
            Impossible de lire les cartes enregistrées sur cet appareil.
          </p>
        )}
        {data.status === 'ready' && (
          <>
            <Today stats={data.stats} now={now()} />
            {data.stats.total > 0 && (
              data.stats.today > 0
                ? <GlassButton tone="new" className={GLASS_PRIMARY} onClick={() => onStudy()}>Commencer à étudier</GlassButton>
                : <GlassButton tone="new" className={GLASS_PRIMARY} onClick={onReviewAll}>Réviser à nouveau</GlassButton>
            )}
            <Tags tags={data.stats.tags} onStudy={onStudy} />
          </>
        )}
      </main>
    </Page>
  )
}

/** Bloc principal : cartes du jour + 3 compteurs. Chiffres et libellés neutres (noir / blanc, label-2) sur le verre. */
function Today({ stats, now }: { stats: HomeStats; now: Date }) {
  if (stats.total === 0) {
    return (
      // Seul titre de la page dans cet état : <h1> pour les lecteurs d'écran.
      <h1 className="glass-card rounded-[28px] p-6 text-center text-[17px] font-normal text-label-2">
        {navigator.onLine === false
          ? 'Connecte-toi à internet pour la première synchronisation.'
          : "Aucune carte pour l'instant. Lance /flashcards sur le Mac."}
      </h1>
    )
  }
  const counters = [
    { label: 'À revoir', n: stats.due, dot: 'bg-hard-pill' },
    { label: 'Nouvelles', n: stats.fresh, dot: 'bg-new-pill' },
    { label: 'Maîtrisées', n: stats.mastered, dot: 'bg-good-pill' },
  ]
  return (
    <section aria-labelledby="today" className="glass-card rounded-[28px] p-5 text-black dark:text-white">
      {stats.today > 0 ? (
        <h1 id="today" className="text-[22px] leading-tight font-semibold">
          <span className="text-[44px] leading-none font-bold tabular-nums">{stats.today}</span>
          {' '}{todaySuffix(stats.today)}
        </h1>
      ) : (
        <>
          <h1 id="today" className="text-[22px] leading-tight font-semibold">Aucune carte à revoir aujourd'hui</h1>
          <p className="mt-1 text-[15px] text-label-2">
            {stats.nextDueAt ? `Prochaine révision dans ${formatInterval(now, stats.nextDueAt)}.` : 'Tout est à jour.'}
          </p>
        </>
      )}
      {/* Pavés opaques (léger voile neutre), jamais floutés : pas de flou imbriqué dans la carte. */}
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {counters.map(c => (
          <div key={c.label} className="flex flex-col-reverse items-center rounded-2xl bg-black/4 px-1 py-2.5 dark:bg-white/7">
            <dt className="flex items-center gap-1.5 text-[13px] leading-4 text-label-2">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${c.dot}`} />
              {c.label}
            </dt>
            <dd className="text-[26px] leading-8 font-bold tabular-nums">{c.n}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * « Mes tags » : les 8 tags, pastilles opaques aux couleurs du tag (contrastes déjà validés, cf. index.css),
 * cible ≥ 44 px. Tag sans carte : grisé, non cliquable (`aria-disabled`, reste lisible et atteignable au clavier).
 */
function Tags({ tags, onStudy }: { tags: TagCount[]; onStudy(tag: string): void }) {
  return (
    <section aria-labelledby="tags" className="glass-card rounded-[28px] p-4 text-black dark:text-white">
      <h2 id="tags" className="mb-3 px-1 text-[17px] leading-tight font-semibold">Mes tags</h2>
      <ul role="list" className="grid auto-rows-fr grid-cols-2 gap-2">
        {tags.map(t => {
          const empty = t.count === 0
          return (
            <li key={t.slug}>
              <button
                type="button"
                aria-disabled={empty || undefined}
                aria-label={`${t.label}, ${cards(t.count)}`}
                onClick={empty ? undefined : () => onStudy(t.slug)}
                className={`tag-btn flex h-full min-h-11 w-full items-center gap-2 rounded-2xl px-3 py-1.5 text-start ${empty ? 'tag-btn-empty' : ''}`}
                style={empty ? undefined : { backgroundColor: `var(--tag-${t.color}-bg)`, color: `var(--tag-${t.color}-fg)` }}
              >
                <span aria-hidden="true" className={`text-[17px] leading-none ${empty ? 'grayscale' : ''}`}>{t.emoji}</span>
                <span className="min-w-0 flex-1 text-[14px] leading-tight font-medium">{t.label}</span>
                <span className="text-[14px] leading-tight font-semibold tabular-nums">{t.count}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
