import { Page, Preloader } from 'konsta/react'
import { BarTitle, EDGES, TopBar, type SyncIndicator } from '../../components/TopBar'
import { sortTags } from '../../lib/home'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { TagChip } from './TagChip'
import type { HomeData } from './useHomeData'

interface Props {
  data: HomeData
  sync?: SyncIndicator
  /** Tap sur un tag : session du jour limitée au tag. */
  onStudy(tag: string): void
  onBack(): void
}

/**
 * Page « Mes tags » (#53) : les 8 tags (vides compris, grisés), triés comme sur l'accueil ; tap → session du tag. Surfaces floutées : barre du haut et carte
 * de la liste (2) ; les pastilles posées sur la carte n'ont pas de flou.
 */
export function TagsScreen({ data, sync, onStudy, onBack }: Props) {
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar onBack={onBack} backLabel="Accueil">
        <BarTitle title="Vault Cards" sync={sync} />
      </TopBar>
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3 py-2 ${EDGES}`}>
        {data.status === 'loading' && <div className="my-auto flex justify-center"><Preloader /></div>}
        {data.status === 'error' && (
          <p role="alert" className="glass-card my-auto rounded-[28px] p-6 text-center text-[17px] text-label-2">
            Impossible de lire les cartes enregistrées sur cet appareil.
          </p>
        )}
        {data.status === 'ready' && (
          <section aria-labelledby="all-tags" className="glass-card rounded-[28px] p-4 text-black dark:text-white">
            <h1 id="all-tags" className="mb-3 px-1 text-[22px] leading-tight font-semibold">Mes tags</h1>
            <ul role="list" className="flex flex-col gap-2">
              {sortTags(data.stats.tags).map(t => (
                <li key={t.slug}><TagChip tag={t} onStudy={onStudy} /></li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </Page>
  )
}
