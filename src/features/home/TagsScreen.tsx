import { Page, Preloader } from 'konsta/react'
import { BarTitle, EDGES, TopBar } from '../../components/TopBar'
import { sortTags, tagsSubtitle, type TagCount } from '../../lib/home'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { TagChip } from './TagChip'
import type { HomeData } from './useHomeData'

interface Props {
  data: HomeData
  /** Tap sur un tag : session du jour limitée au tag. */
  onStudy(tag: string): void
  onBack(): void
}

/**
 * Page « Mes tags » v3 (#53, #82, Paper « Mes tags · v3 ») : titre et sous-titre dans la barre (pas de gros titre
 * dessous), puis deux groupes de pastilles : « À revoir aujourd'hui » (badge bleu = cartes dues, triés comme sur
 * l'accueil) et « À jour » (pastilles grises, tags vides compris). Pas de carte en verre autour : chaque tag dû est
 * son propre verre ; les tags à jour n'ont pas de flou. Tap → session du tag.
 */
export function TagsScreen({ data, onStudy, onBack }: Props) {
  const ready = data.status === 'ready' ? data.stats : null
  const sorted = ready ? sortTags(ready.tags) : []
  const due = sorted.filter(t => t.today > 0)
  const upToDate = sorted.filter(t => t.today === 0)
  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <TopBar onBack={onBack} backLabel="Accueil">
        <BarTitle title="Mes tags" subtitle={ready ? tagsSubtitle(ready.today) : undefined} heading />
      </TopBar>
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-5 pt-2 pb-4 ${EDGES}`}>
        {data.status === 'loading' && <div className="my-auto flex justify-center"><Preloader /></div>}
        {data.status === 'error' && (
          <p role="alert" className="glass-card my-auto rounded-[28px] p-6 text-center text-[17px] text-label-2">
            Impossible de lire les cartes enregistrées sur cet appareil.
          </p>
        )}
        {ready && <TagGroup id="tags-due" title="À revoir aujourd'hui" tags={due} onStudy={onStudy} />}
        {ready && <TagGroup id="tags-up-to-date" title="À jour" tags={upToDate} onStudy={onStudy} />}
      </main>
    </Page>
  )
}

function TagGroup({ id, title, tags, onStudy }: { id: string; title: string; tags: TagCount[]; onStudy(tag: string): void }) {
  if (tags.length === 0) return null
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="px-1 text-[13px] leading-4 font-semibold tracking-[0.06em] text-label-2 uppercase">{title}</h2>
      <ul role="list" className="flex flex-wrap gap-2.5">
        {tags.map(t => <li key={t.name}><TagChip tag={t} onStudy={onStudy} /></li>)}
      </ul>
    </section>
  )
}
