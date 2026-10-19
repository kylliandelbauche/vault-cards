import { Page, Preloader } from 'konsta/react'
import type { ReactNode } from 'react'
import { GLASS_PRIMARY, GlassButton } from '../../components/GlassButton'
import { BarTitle, EDGES, SignOutButton, TopBar, type SyncIndicator } from '../../components/TopBar'
import { formatInterval } from '../../lib/format'
import { cards, shortcutTags, todaySuffix, type HomeStats, type TagCount } from '../../lib/home'
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
  /** Ligne « Mes tags › » : page de tous les tags. */
  onOpenTags(): void
  onSignOut?(): void
  /** Bloc « Nouvelles cartes » (#81), entre le bloc du jour et Mes tags. */
  newCards?: ReactNode
}

/**
 * Écran d'accueil (#53, #63). Surfaces floutées : barre du haut, carte « aujourd'hui », carte « Nouvelles cartes »
 * (#81), carte « Mes tags » (4, aucune imbriquée). Le bouton d'action, les compteurs et les tags sont posés sur les cartes, sans flou propre.
 */
export function HomeScreen({ data, now, sync, onStudy, onReviewAll, onOpenTags, onSignOut, newCards }: Props) {
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
            <Today stats={data.stats} now={now()} onStudy={() => onStudy()} onReviewAll={onReviewAll} />
            {newCards}
            <Tags tags={data.stats.tags} onStudy={onStudy} onOpenTags={onOpenTags} />
          </>
        )}
      </main>
    </Page>
  )
}

interface TodayProps {
  stats: HomeStats
  now: Date
  onStudy(): void
  onReviewAll(): void
}

const COUNTERS = [
  { label: 'À revoir', key: 'due', dot: 'bg-dot-due' },
  { label: 'Nouvelles', key: 'fresh', dot: 'bg-dot-new' },
  { label: 'Maîtrisées', key: 'mastered', dot: 'bg-dot-mastered' },
] as const

/**
 * Bloc du jour (maquette 1, #63), toutes les cartes : grand chiffre mis en avant suivi de « cartes à revoir aujourd'hui » (même
 * ligne si la largeur le permet), 3 compteurs en tuiles avec pastille colorée décorative, puis le bouton d'action,
 * dans la même carte en verre. Chiffres et libellés neutres. Le bouton est en verre imité (`on-glass` : teinte,
 * lueur, liseré, reflet, sans backdrop-filter) : pas de flou imbriqué.
 */
function Today({ stats, now, onStudy, onReviewAll }: TodayProps) {
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
  return (
    <section aria-labelledby="today" className="glass-card rounded-[28px] p-5 text-black dark:text-white">
      {stats.today > 0 ? (
        <h1 id="today" className="flex flex-wrap items-baseline gap-x-2 text-[19px] leading-tight font-semibold">
          <span className="text-[52px] leading-[1.05] font-bold tracking-tight tabular-nums">{stats.today}</span>
          {' '}<span>{todaySuffix(stats.today)}</span>
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
        {COUNTERS.map(c => (
          <div key={c.label} className="flex flex-col-reverse items-center rounded-2xl bg-black/4 px-1 py-2.5 dark:bg-white/7">
            <dt className="flex items-center gap-1.5 text-[13px] leading-4 text-label-2">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${c.dot}`} />
              {c.label}
            </dt>
            <dd className="text-[28px] leading-8 font-bold tabular-nums">{stats[c.key]}</dd>
          </div>
        ))}
      </dl>
      {stats.today > 0
        ? <GlassButton tone="new" className={`${GLASS_PRIMARY} on-glass mt-4`} onClick={onStudy}>Commencer à étudier</GlassButton>
        : <GlassButton tone="new" className={`${GLASS_PRIMARY} on-glass mt-4`} onClick={onReviewAll}>Réviser à nouveau</GlassButton>}
    </section>
  )
}

/**
 * « Mes tags » (#63) : la ligne du titre (≥ 44 px) ouvre la page de tous les tags ; dessous, une rangée défilante
 * de raccourcis : les tags non vides, triés par nombre de cartes, en verre neutre (texte seul). Tap → session du
 * tag, comme sur la page Mes tags. Rien n'est sélectionnable.
 */
function Tags({ tags, onStudy, onOpenTags }: { tags: TagCount[]; onStudy(tag: string): void; onOpenTags(): void }) {
  return (
    <section aria-labelledby="tags-title" className="glass-card rounded-[28px] pt-4 pb-3 text-black dark:text-white">
      <h2 className="mx-4">
        <button
          type="button"
          onClick={onOpenTags}
          className="tag-head -mx-1 -mt-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center justify-between rounded-2xl px-2 text-start text-[17px] leading-tight font-semibold"
        >
          <span id="tags-title">Mes tags</span>
          <span className="sr-only">, voir les {tags.length} tags</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 text-label-2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </h2>
      {/* Pleine largeur de la carte (les chips glissent jusqu'au bord) ; marges internes = alignement du titre. */}
      <ul role="list" aria-label="Réviser un tag" className="chip-row flex gap-2 scroll-px-4 px-4 py-1">
        {shortcutTags(tags).map(t => (
          <li key={t.slug} className="shrink-0">
            <GlassButton
              tone="neutral"
              aria-label={`${t.label}, ${cards(t.total)}`}
              onClick={() => onStudy(t.slug)}
              className="on-glass tag-chip flex min-h-11 items-center rounded-full px-4 text-[15px] leading-tight font-medium whitespace-nowrap"
            >
              {t.label}
            </GlassButton>
          </li>
        ))}
      </ul>
    </section>
  )
}
