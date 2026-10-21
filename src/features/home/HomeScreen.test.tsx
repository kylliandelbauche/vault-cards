import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { TAGS } from '../../../shared/tags'
import type { HomeStats, TagCount } from '../../lib/home'
import { BarActionsProvider } from '../../components/TopBar'
import { HomeScreen } from './HomeScreen'
import type { HomeData } from './useHomeData'

const now = () => new Date('2026-10-13T10:00:00Z')
const COUNTS: Record<string, [number, number]> = { ia: [7, 5], dev: [3, 0], culture: [5, 1] }
const tagCounts = (): TagCount[] => TAGS.map(t => ({ ...t, total: COUNTS[t.slug]?.[0] ?? 0, today: COUNTS[t.slug]?.[1] ?? 0 }))
const stats = (over: Partial<HomeStats> = {}): HomeStats => ({
  today: 12, due: 4, fresh: 8, mastered: 30, total: 50, nextDueAt: null, tags: tagCounts(), ...over,
})
const ready = (over: Partial<HomeStats> = {}): HomeData => ({ status: 'ready', stats: stats(over) })

interface Handlers { onStudy?: () => void; onReviewAll?: () => void }

function renderHome(data: HomeData = ready(), handlers: Handlers = {}) {
  const onSignOut = vi.fn()
  const props = { onStudy: vi.fn(), onReviewAll: vi.fn(), onOpenTags: vi.fn(), ...handlers }
  const r = render(
    <KApp theme="ios">
      <BarActionsProvider value={{ onSignOut }}><HomeScreen data={data} now={now} sync="synced" {...props} /></BarActionsProvider>
    </KApp>,
  )
  return { ...r, ...props, onSignOut }
}

const chipRow = () => screen.getByRole('list', { name: 'Réviser un tag' })
const chips = () => within(chipRow()).getAllByRole('button')

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
    // #82 : bleu plein (la seule action bleue forte de l'écran), icône ▶ décorative, libellé seul pour VoiceOver.
    expect(start.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'btn-filled', 'on-glass', 'h-14']))
    expect(start.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(document.querySelectorAll('.btn-filled')).toHaveLength(1)
    // Dans la carte du jour (comme la maquette), sans flou propre.
    expect(start.closest('section.glass-card')?.querySelector('h1')).toBeTruthy()
    await userEvent.setup().click(start)
    expect(onStudy).toHaveBeenCalledWith()
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

  it('tags = raccourcis : les tags non vides triés par nombre de cartes, texte seul ; tags vides absents ; rien de sélectionnable', () => {
    renderHome()
    expect(chips().map(b => b.getAttribute('aria-label'))).toEqual(['IA & agents, 7 cartes', 'Culture, 5 cartes', 'Dev & outils, 3 cartes'])
    expect(chips().map(b => b.textContent)).toEqual(['IA & agents', 'Culture', 'Dev & outils'])
    expect(screen.queryByRole('button', { name: /^Tous/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Sécurité/ })).toBeNull()
    for (const b of chips()) {
      expect(b.hasAttribute('aria-pressed')).toBe(false)
      expect(b.className.split(' ')).toContain('glass-btn-neutral')
      expect(b.className).not.toContain('glass-btn-new')
    }
    // Aucun emoji rendu : un tag est du texte seul.
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('tap sur un tag : session du tag ; le bloc du jour reste celui de toutes les cartes', async () => {
    const { onStudy } = renderHome()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dev & outils, 3 cartes' }))
    expect(onStudy).toHaveBeenCalledWith('dev')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("12 cartes à revoir aujourd'hui")
    expect(screen.getAllByRole('definition').map(d => d.textContent)).toEqual(['4', '8', '30'])
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
    const { container } = renderHome()
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

  it('surfaces floutées : carte du jour + carte des tags = 2, aucune imbriquée ; barre, bouton, pastilles et compteurs sans flou', () => {
    const { container } = renderHome()
    expect(container.querySelectorAll(SURFACES)).toHaveLength(2)
    expect(container.querySelectorAll('.glass-card .glass-btn:not(.on-glass)')).toHaveLength(0)
    expect(container.querySelectorAll(NESTED)).toHaveLength(0)
    for (const el of container.querySelectorAll('dl div')) expect(el.className).not.toMatch(/glass|backdrop|blur/)
    for (const el of container.querySelectorAll('.tag-chip')) expect(el.className).toContain('on-glass')
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/\b(min-h-11|size-12|h-14)\b/)
  })

  it('barre du haut (#82) : « Vault Cards » + synchro à gauche, Recherche et Profil à droite ; déconnexion via Profil', async () => {
    const { container, onSignOut } = renderHome()
    const header = container.querySelector('header')!
    expect(header.querySelector('.glass, .glass-card')).toBeNull()
    expect(within(header).getByText('Vault Cards').className).toContain('text-[22px]')
    expect(within(header).getByRole('status').textContent).toBe('Synchronisé')
    expect(within(header).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual(['Rechercher', 'Profil'])
    expect(screen.queryByRole('button', { name: /Déconnexion|Créer/ })).toBeNull()
    const user = userEvent.setup()
    await user.click(within(header).getByRole('button', { name: 'Profil' }))
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
  it('aucune carte : message habituel, pas de bouton d’étude, aucun raccourci de tag', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const empty = TAGS.map(t => ({ ...t, total: 0, today: 0 }))
    renderHome(ready({ today: 0, due: 0, fresh: 0, mastered: 0, total: 0, tags: empty }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Aucune carte pour l'instant. Lance /flashcards sur le Mac.")
    expect(screen.queryByRole('button', { name: /Commencer|Réviser/ })).toBeNull()
    expect(within(chipRow()).queryAllByRole('button')).toHaveLength(0)
  })

  it('chargement puis erreur de lecture du cache', () => {
    const { rerender } = renderHome({ status: 'loading' })
    expect(screen.queryByRole('button', { name: 'Commencer à étudier' })).toBeNull()
    rerender(<KApp theme="ios"><HomeScreen data={{ status: 'error' }} now={now} onStudy={vi.fn()} onReviewAll={vi.fn()} onOpenTags={vi.fn()} /></KApp>)
    expect(screen.getByRole('alert').textContent).toBe('Impossible de lire les cartes enregistrées sur cet appareil.')
  })
})
