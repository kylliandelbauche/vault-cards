import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { useState } from 'react'
import { TAGS } from '../../../shared/tags'
import type { HomeStats, TagCount } from '../../lib/home'
import { HomeScreen } from './HomeScreen'
import type { HomeData } from './useHomeData'

const now = () => new Date('2026-10-13T10:00:00Z')
const COUNTS: Record<string, Partial<TagCount>> = {
  ia: { total: 7, today: 5, due: 2, fresh: 3, mastered: 1 },
  dev: { total: 3, today: 0, due: 0, fresh: 0, mastered: 3, nextDueAt: new Date('2026-10-14T10:00:00Z') },
  culture: { total: 5, today: 1, due: 1, fresh: 0, mastered: 0 },
}
const tagCounts = (): TagCount[] =>
  TAGS.map(t => ({ ...t, total: 0, today: 0, due: 0, fresh: 0, mastered: 0, nextDueAt: null, ...COUNTS[t.slug] }))
const stats = (over: Partial<HomeStats> = {}): HomeStats => ({
  today: 12, due: 4, fresh: 8, mastered: 30, total: 50, nextDueAt: null, tags: tagCounts(), ...over,
})
const ready = (over: Partial<HomeStats> = {}): HomeData => ({ status: 'ready', stats: stats(over) })

interface Handlers { onStudy?: () => void; onReviewAll?: () => void; onSignOut?: () => void }

function renderHome(data: HomeData = ready(), handlers: Handlers = {}, filter: string | null = null) {
  const props = { onStudy: vi.fn(), onReviewAll: vi.fn(), onSignOut: vi.fn(), onOpenTags: vi.fn(), onFilter: vi.fn(), ...handlers }
  const r = render(<KApp theme="ios"><HomeScreen data={data} now={now} sync="synced" filter={filter} {...props} /></KApp>)
  return { ...r, ...props }
}

/** Filtre contrôlé, comme dans l'App : la sélection est gardée au-dessus de l'écran. */
function Controlled({ onStudy }: { onStudy(tag?: string): void }) {
  const [filter, setFilter] = useState<string | null>(null)
  return (
    <KApp theme="ios">
      <HomeScreen data={ready()} now={now} filter={filter} onFilter={setFilter} onStudy={onStudy} onReviewAll={vi.fn()} onOpenTags={vi.fn()} />
    </KApp>
  )
}

const chipRow = () => screen.getByRole('list', { name: 'Filtrer les cartes' })
const chips = () => within(chipRow()).getAllByRole('button')
const pressed = () => chips().filter(b => b.getAttribute('aria-pressed') === 'true')

// Surfaces floutées : les boutons `on-glass` (verre imité, sans backdrop-filter) n'en sont pas.
const BLURRED = ['.glass', '.glass-card', '.glass-btn:not(.on-glass)']
const SURFACES = BLURRED.join(', ')
const NESTED = BLURRED.flatMap(a => BLURRED.map(b => `${a} ${b}`)).join(', ')

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('HomeScreen', () => {
  it('bloc principal : « N cartes à revoir aujourd’hui » + « Commencer à étudier » (session de toutes les cartes)', async () => {
    const { onStudy } = renderHome()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("12 cartes à revoir aujourd'hui")
    const start = screen.getByRole('button', { name: 'Commencer à étudier' })
    expect(start.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-new', 'on-glass', 'h-14']))
    // Dans la carte du jour (comme la maquette), sans flou propre.
    expect(start.closest('section.glass-card')?.querySelector('h1')).toBeTruthy()
    await userEvent.setup().click(start)
    expect(onStudy).toHaveBeenCalledWith(undefined) // « Tous » : pas de tag
  })

  it('singulier : « 1 carte à revoir aujourd’hui »', () => {
    renderHome(ready({ today: 1, due: 1, fresh: 0 }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("1 carte à revoir aujourd'hui")
  })

  it('rien à revoir : message clair, prochaine révision, et « Réviser à nouveau » (révision libre)', async () => {
    const { onReviewAll } = renderHome(ready({ today: 0, due: 0, fresh: 0, nextDueAt: new Date('2026-10-13T13:00:00Z') }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Aucune carte à revoir aujourd'hui")
    expect(screen.getByText('Prochaine révision dans 3 h.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Commencer à étudier' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Réviser à nouveau' }).closest('section.glass-card')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réviser à nouveau' }))
    expect(onReviewAll).toHaveBeenCalledTimes(1)
  })

  it('3 compteurs : À revoir, Nouvelles, Maîtrisées (libellé lu avant le nombre)', () => {
    renderHome()
    const terms = screen.getAllByRole('term').map(t => t.textContent)
    const values = screen.getAllByRole('definition').map(d => d.textContent)
    expect(terms).toEqual(['À revoir', 'Nouvelles', 'Maîtrisées'])
    expect(values).toEqual(['4', '8', '30'])
  })

  it('compteurs : pastille colorée décorative (orange, bleu, vert), aria-hidden', () => {
    const { container } = renderHome()
    const dots = [...container.querySelectorAll('dt > span')]
    expect(dots.map(d => d.className.match(/bg-dot-\w+/)?.[0])).toEqual(['bg-dot-due', 'bg-dot-new', 'bg-dot-mastered'])
    for (const d of dots) expect(d.getAttribute('aria-hidden')).toBe('true')
  })

  it('grand chiffre mis en avant, puis le texte (même titre)', () => {
    renderHome()
    const big = screen.getByRole('heading', { level: 1 }).firstElementChild as HTMLElement
    expect(big.textContent).toBe('12')
    expect(big.className).toMatch(/text-\[52px\]/)
    expect(big.className).toMatch(/\bfont-bold\b/)
  })

  it('filtres : « Tous » sélectionné par défaut, puis les tags non vides triés par nombre de cartes ; tags vides absents', () => {
    renderHome()
    expect(chips().map(b => b.getAttribute('aria-label'))).toEqual(['Tous, 50 cartes', 'IA & agents, 7 cartes', 'Culture, 5 cartes', 'Dev & outils, 3 cartes'])
    expect(chips().map(b => b.textContent)).toEqual(['Tous', 'IA & agents', 'Culture', 'Dev & outils'])
    expect(pressed().map(b => b.textContent)).toEqual(['Tous'])
    expect(chips().every(b => b.hasAttribute('aria-pressed'))).toBe(true)
    expect(screen.queryByRole('button', { name: /^Sécurité/ })).toBeNull()
    // Aucun emoji rendu : un tag est du texte seul.
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('filtre sélectionné : liseré et lueur bleus de « Commencer à étudier » ; les autres en verre neutre', () => {
    renderHome(ready(), {}, 'culture')
    const [all, ia, culture] = chips()
    expect(pressed()).toEqual([culture])
    expect(culture.className.split(' ')).toContain('glass-btn-new')
    for (const b of [all, ia]) {
      expect(b.className.split(' ')).toContain('glass-btn-neutral')
      expect(b.className).not.toContain('glass-btn-new')
    }
  })

  it('tap sur un filtre : onFilter(slug) ; « Tous » : onFilter(null)', async () => {
    const { onFilter } = renderHome(ready(), {}, 'ia')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Dev & outils, 3 cartes' }))
    expect(onFilter).toHaveBeenLastCalledWith('dev')
    await user.click(screen.getByRole('button', { name: 'Tous, 50 cartes' }))
    expect(onFilter).toHaveBeenLastCalledWith(null)
  })

  it('un seul filtre sélectionné ; chiffre et compteurs suivent le filtre ; « Commencer à étudier » lance la file du filtre', async () => {
    const onStudy = vi.fn()
    render(<Controlled onStudy={onStudy} />)
    const user = userEvent.setup()
    const title = () => screen.getByRole('heading', { level: 1 }).textContent
    const values = () => screen.getAllByRole('definition').map(d => d.textContent)
    await user.click(screen.getByRole('button', { name: 'IA & agents, 7 cartes' }))
    expect(pressed().map(b => b.textContent)).toEqual(['IA & agents'])
    expect(title()).toBe("5 cartes à revoir aujourd'hui")
    expect(values()).toEqual(['2', '3', '1'])
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    expect(onStudy).toHaveBeenLastCalledWith('ia')

    await user.click(screen.getByRole('button', { name: 'Culture, 5 cartes' }))
    expect(pressed().map(b => b.textContent)).toEqual(['Culture'])
    expect(title()).toBe("1 carte à revoir aujourd'hui")

    await user.click(screen.getByRole('button', { name: 'Tous, 50 cartes' }))
    expect(pressed().map(b => b.textContent)).toEqual(['Tous'])
    expect(title()).toBe("12 cartes à revoir aujourd'hui")
    expect(values()).toEqual(['4', '8', '30'])
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    expect(onStudy).toHaveBeenLastCalledWith(undefined)
  })

  it('filtre sans carte du jour : prochaine révision du tag et « Réviser à nouveau » limité au tag', async () => {
    const { onReviewAll } = renderHome(ready(), {}, 'dev')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Aucune carte à revoir aujourd'hui")
    expect(screen.getByText(/^Prochaine révision dans/)).toBeTruthy()
    expect(screen.getAllByRole('definition').map(d => d.textContent)).toEqual(['0', '0', '3'])
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réviser à nouveau' }))
    expect(onReviewAll).toHaveBeenCalledWith('dev')
  })

  it('filtre retenu devenu vide ou inconnu : retour à « Tous »', () => {
    renderHome(ready(), {}, 'securite')
    expect(pressed().map(b => b.textContent)).toEqual(['Tous'])
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("12 cartes à revoir aujourd'hui")
  })

  it('rangée défilante : classe chip-row, chips sans retour à la ligne ni rétrécissement, cibles ≥ 44 px', () => {
    renderHome()
    expect(chipRow().className.split(' ')).toEqual(expect.arrayContaining(['chip-row', 'flex']))
    for (const li of within(chipRow()).getAllByRole('listitem')) expect(li.className).toContain('shrink-0')
    for (const b of chips()) {
      expect(b.className).toMatch(/\bwhitespace-nowrap\b/)
      expect(b.className).toMatch(/\bmin-h-11\b/)
    }
  })

  it('aucune couleur par tag : ni style en ligne, ni jeton --tag-<couleur>', () => {
    const { container } = renderHome(ready(), {}, 'ia')
    for (const b of chips()) expect(b.getAttribute('style') ?? '').not.toMatch(/--chip|--tag/)
    expect(container.innerHTML).not.toMatch(/--tag-[a-z]+-fg|--chip-fg/)
  })

  it('« Mes tags › » : toute la ligne du titre (≥ 44 px) ouvre la page de tous les tags', async () => {
    const { onOpenTags } = renderHome()
    const head = screen.getByRole('button', { name: 'Mes tags, voir les 8 tags' })
    expect(head.closest('h2')).toBeTruthy()
    expect(head.className).toMatch(/\bmin-h-11\b/)
    expect(head.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    await userEvent.setup().click(head)
    expect(onOpenTags).toHaveBeenCalledTimes(1)
  })

  it('surfaces floutées : barre + carte du jour + carte des tags = 3, aucune imbriquée ; bouton, pastilles et compteurs sans flou', () => {
    const { container } = renderHome()
    expect(container.querySelectorAll(SURFACES)).toHaveLength(3)
    expect(container.querySelectorAll('.glass-card .glass-btn:not(.on-glass)')).toHaveLength(0)
    expect(container.querySelectorAll(NESTED)).toHaveLength(0)
    for (const el of container.querySelectorAll('dl div')) expect(el.className).not.toMatch(/glass|backdrop|blur/)
    for (const el of container.querySelectorAll('.tag-chip')) expect(el.className).toContain('on-glass')
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/\b(min-h-11|size-11|h-14)\b/)
  })

  it('barre du haut en verre : titre, état de synchro, déconnexion ; pas de bouton « Créer une carte »', async () => {
    const { container, onSignOut } = renderHome()
    const header = container.querySelector('header')!
    expect(header.querySelector('.glass')).toBeTruthy()
    expect(within(header).getByText('Vault Cards')).toBeTruthy()
    expect(within(header).getByRole('status').textContent).toBe('Synchronisé')
    await userEvent.setup().click(within(header).getByRole('button', { name: 'Déconnexion' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Créer/ })).toBeNull()
  })

  it('aucune carte : message habituel, pas de bouton d’étude, seul le filtre « Tous »', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const empty = TAGS.map(t => ({ ...t, total: 0, today: 0, due: 0, fresh: 0, mastered: 0, nextDueAt: null }))
    renderHome(ready({ today: 0, due: 0, fresh: 0, mastered: 0, total: 0, tags: empty }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Aucune carte pour l'instant. Lance /flashcards sur le Mac.")
    expect(screen.queryByRole('button', { name: /Commencer|Réviser/ })).toBeNull()
    expect(chips().map(b => b.textContent)).toEqual(['Tous'])
  })

  it('chargement puis erreur de lecture du cache', () => {
    const { rerender } = renderHome({ status: 'loading' })
    expect(screen.queryByRole('button', { name: 'Commencer à étudier' })).toBeNull()
    rerender(<KApp theme="ios"><HomeScreen data={{ status: 'error' }} now={now} filter={null} onFilter={vi.fn()} onStudy={vi.fn()} onReviewAll={vi.fn()} onOpenTags={vi.fn()} /></KApp>)
    expect(screen.getByRole('alert').textContent).toBe('Impossible de lire les cartes enregistrées sur cet appareil.')
  })
})
