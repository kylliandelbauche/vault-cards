import { Page } from 'konsta/react'
import { useMemo, useState } from 'react'
import { MAX_TAGS, byTagName, normalizeTagName, tagKey, tagNameError } from '../../../shared/tags'
import { DiscardDialog, SheetBar } from '../../components/SheetBar'
import { EDGES } from '../../components/TopBar'
import { cards } from '../../lib/home'
import type { TagChoice } from '../../lib/tags'
import { TRANSPARENT_PAGE } from '../../lib/theme'
import { indexLetter } from './useTagChoices'

interface Props {
  /** Tags de la carte à l'ouverture. */
  initial: readonly string[]
  /** Tags existants avec leur nombre de cartes (null : en chargement). */
  choices: readonly TagChoice[] | null
  onCancel(): void
  onDone(tags: string[]): void
}

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#']
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i])
const SECTION = 'px-1 text-[13px] leading-4 font-semibold tracking-[0.06em] text-label-2'

/**
 * « Ajouter des tags » (#79, Paper « Ajouter des tags · 1 à 4 ») : recherche, rangée « Sur cette carte · n » (× retire),
 * liste A–Z des tags avec leur nombre de cartes et index A–Z (colonne de lettres qui fait défiler). Toucher une ligne
 * ajoute ou retire le tag ; plusieurs à la suite. Aucun tag de même nom (casse ignorée) → ligne « + Créer « … » » :
 * le tag est créé ET ajouté en un geste (bulle en premier, champ vidé). Rien n'est écrit ici : ✓ rend la liste à
 * « Modifier la carte », qui enregistre ; un nom nouveau ne devient un tag qu'à l'enregistrement d'une carte active
 * (trigger serveur), jamais pour un brouillon non validé. ✕ avec modifications → fenêtre de confirmation.
 */
export function AddTagsScreen({ initial, choices, onCancel, onDone }: Props) {
  const [selected, setSelected] = useState<string[]>([...initial])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const dirty = !sameList(selected, initial)
  const full = selected.length >= MAX_TAGS
  const selectedKeys = new Set(selected.map(tagKey))

  // Tags existants + noms de la carte pas encore créés (brouillon de l'IA, tag créé ici) : tous visibles et retirables.
  const rows = useMemo(() => {
    const list: TagChoice[] = [...(choices ?? [])]
    const known = new Set(list.map(t => tagKey(t.name)))
    for (const name of selected) if (!known.has(tagKey(name))) list.push({ name, cards: 0 })
    return list.sort((a, b) => byTagName(a.name, b.name))
  }, [choices, selected])

  const q = normalizeTagName(query)
  const visible = q === '' ? rows : rows.filter(t => tagKey(t.name).includes(q.toLowerCase()))
  const exact = q !== '' && rows.some(t => tagKey(t.name) === q.toLowerCase())
  const sections = new Map<string, TagChoice[]>()
  for (const t of visible) sections.set(indexLetter(t.name), [...(sections.get(indexLetter(t.name)) ?? []), t])

  const toggle = (name: string) => {
    setError(null)
    if (selectedKeys.has(tagKey(name))) setSelected(s => s.filter(t => tagKey(t) !== tagKey(name)))
    else if (full) setError(`${MAX_TAGS} tags au maximum par carte.`)
    else setSelected(s => [...s, name])
  }

  const create = () => {
    const problem = tagNameError(q)
    if (problem) { setError(`${problem.charAt(0).toUpperCase()}${problem.slice(1)}.`); return }
    if (full) { setError(`${MAX_TAGS} tags au maximum par carte.`); return }
    setSelected(s => [q, ...s])
    setQuery('')
    setError(null)
  }

  return (
    <Page colors={TRANSPARENT_PAGE} className="flex flex-col overscroll-none">
      <SheetBar
        title="Ajouter des tags"
        onClose={() => (dirty ? setConfirming(true) : onCancel())}
        onConfirm={() => onDone(selected)}
        confirmLabel="Valider les tags"
      />
      <main className={`mx-auto flex w-full max-w-xl flex-1 flex-col gap-3.5 py-2 ${EDGES}`}>
        <label className="glass-card flex h-11 shrink-0 items-center gap-2.5 rounded-full px-3.5">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] shrink-0 text-label-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" />
          </svg>
          <span className="sr-only">Rechercher ou créer un tag</span>
          <input
            type="search"
            value={query}
            onChange={e => { setQuery(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter' && q !== '' && !exact) create() }}
            placeholder="Rechercher ou créer un tag"
            enterKeyHint="done"
            className="min-w-0 flex-1 bg-transparent text-[17px] leading-[22px] text-black outline-none placeholder:text-label-2 dark:text-white"
          />
        </label>

        {error && <p role="alert" className="mx-auto w-fit rounded-full bg-again-tint px-3 py-0.5 text-center text-[15px] text-again">{error}</p>}

        {/* Rangée « Sur cette carte » à hauteur fixe (44 px) : vide ou pleine, rien ne bouge en dessous (règle des composants à taille fixe). */}
        <section aria-labelledby="on-card" className="flex shrink-0 flex-col gap-2">
          <h2 id="on-card" className={SECTION}>SUR CETTE CARTE · {selected.length}</h2>
          {selected.length === 0
            ? <p className="flex h-11 items-center px-1 text-[15px] leading-5 text-label-2">Aucun tag pour l’instant.</p>
            : (
              <ul role="list" className="chip-row flex h-11 items-center gap-2">
                {selected.map(name => (
                  <li key={tagKey(name)} className="shrink-0">
                    <span className="tag-pill flex h-10 items-center gap-2 rounded-full ps-4 pe-2.5 text-[15px] leading-[18px] font-medium whitespace-nowrap">
                      {name}
                      <button
                        type="button"
                        aria-label={`Retirer ${name}`}
                        onClick={() => toggle(name)}
                        className="flex size-[22px] cursor-pointer items-center justify-center rounded-full bg-black/10 dark:bg-white/15"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M7 7l10 10M17 7L7 17" /></svg>
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        <div className="flex min-h-0 flex-1 gap-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {q !== '' && !exact && (
              <button
                type="button"
                onClick={create}
                className="glass-card flex h-12 cursor-pointer items-center gap-2.5 rounded-[20px] px-4 text-start text-[17px] leading-[22px] font-semibold text-new"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                <span className="min-w-0 truncate">Créer « {q} »</span>
              </button>
            )}
            {choices === null && <p className="px-1 text-[15px] text-label-2">Chargement des tags…</p>}
            {[...sections].map(([letter, tags]) => (
              <section key={letter} id={`tags-${letter}`} aria-label={letter} className="flex scroll-mt-2 flex-col gap-1.5">
                <h3 className={`${SECTION} pt-1`} aria-hidden="true">{letter}</h3>
                <ul role="list" className="glass-card flex flex-col rounded-[20px]">
                  {tags.map((t, i) => {
                    const on = selectedKeys.has(tagKey(t.name))
                    return (
                      <li key={tagKey(t.name)} className={i < tags.length - 1 ? 'border-b border-[var(--glass-hairline)]' : ''}>
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-disabled={(!on && full) || undefined}
                          onClick={() => toggle(t.name)}
                          className="flex h-12 w-full cursor-pointer items-center gap-2.5 px-4 text-start"
                        >
                          <span className={`min-w-0 flex-1 truncate text-[17px] leading-[22px] ${on ? 'font-semibold' : 'font-medium'}`}>{t.name}</span>
                          <span className="shrink-0 text-[15px] leading-5 text-label-2">{cards(t.cards)}</span>
                          <svg aria-hidden="true" viewBox="0 0 24 24" className={`size-5 shrink-0 ${on ? '' : 'opacity-0'}`} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
          <nav aria-label="Index A–Z" className="sticky top-2 flex w-4 shrink-0 flex-col items-center self-start py-1.5">
            {LETTERS.map(letter => {
              const has = sections.has(letter)
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={!has}
                  aria-label={`Aller à ${letter}`}
                  onClick={() => document.getElementById(`tags-${letter}`)?.scrollIntoView?.({ block: 'start' })}
                  className={`text-[11px] leading-[16px] font-semibold text-label-2 ${has ? 'cursor-pointer' : 'opacity-35'}`}
                >
                  {letter}
                </button>
              )
            })}
          </nav>
        </div>
      </main>
      {confirming && <DiscardDialog onDiscard={onCancel} onContinue={() => setConfirming(false)} />}
    </Page>
  )
}
