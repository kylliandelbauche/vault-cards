import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { TAGS } from '../../../shared/tags'
import type { HomeStats } from '../../lib/home'
import { HomeScreen } from './HomeScreen'
import type { HomeData } from './useHomeData'

const now = () => new Date('2026-10-13T10:00:00Z')
const stats = (over: Partial<HomeStats> = {}): HomeStats => ({
  today: 12, due: 4, fresh: 8, mastered: 30, total: 50, nextDueAt: null,
  tags: TAGS.map(t => ({ ...t, count: t.slug === 'ia' ? 7 : t.slug === 'dev' ? 3 : t.slug === 'culture' ? 5 : 0, today: 0 })),
  ...over,
})
const ready = (over: Partial<HomeStats> = {}): HomeData => ({ status: 'ready', stats: stats(over) })

function renderHome(data: HomeData = ready(), handlers: { onStudy?: () => void; onReviewAll?: () => void; onSignOut?: () => void } = {}) {
  const props = { onStudy: vi.fn(), onReviewAll: vi.fn(), onSignOut: vi.fn(), onOpenTags: vi.fn(), ...handlers }
  const r = render(<KApp theme="ios"><HomeScreen data={data} now={now} sync="synced" {...props} /></KApp>)
  return { ...r, ...props }
}

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

  it('Mes tags : 4 tags au plus, triés par nombre de cartes décroissant (vides en dernier) ; tap → session du tag', async () => {
    const { onStudy } = renderHome()
    const list = within(screen.getByRole('region', { name: 'Mes tags' })).getByRole('list')
    const buttons = within(list).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['IA & agents, 7 cartes', 'Culture, 5 cartes', 'Dev & outils, 3 cartes', 'Sécurité, 0 carte'])
    expect(buttons[0].textContent).toBe('IA & agents7')
    // Aucun emoji rendu : un tag est du texte seul.
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dev & outils, 3 cartes' }))
    expect(onStudy).toHaveBeenCalledWith('dev')
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

  it('tags sans carte : grisés, aria-disabled, non cliquables ; cibles ≥ 44 px', async () => {
    const { onStudy } = renderHome()
    const empty = screen.getByRole('button', { name: 'Sécurité, 0 carte' })
    expect(empty.getAttribute('aria-disabled')).toBe('true')
    expect(empty.className).toContain('tag-chip-empty')
    expect(empty.getAttribute('style') ?? '').not.toContain('--chip')
    await userEvent.setup().click(empty)
    expect(onStudy).not.toHaveBeenCalled()
    const ia = screen.getByRole('button', { name: 'IA & agents, 7 cartes' })
    expect(ia.hasAttribute('aria-disabled')).toBe(false)
    expect(ia.getAttribute('style')).toContain('--chip: var(--tag-violet-fg)')
    // Verre imité (posé sur la carte « Mes tags ») : bouton en verre sans flou propre.
    expect(ia.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'on-glass', 'tag-chip']))
    for (const b of screen.getAllByRole('button')) expect(b.className).toMatch(/\b(min-h-11|min-h-12|size-11|h-14)\b/)
  })

  it('surfaces floutées : barre + carte du jour + carte des tags = 3, aucune imbriquée ; bouton, pastilles et compteurs sans flou', () => {
    const { container } = renderHome()
    expect(container.querySelectorAll(SURFACES)).toHaveLength(3)
    expect(container.querySelectorAll('.glass-card .glass-btn:not(.on-glass)')).toHaveLength(0)
    expect(container.querySelectorAll(NESTED)).toHaveLength(0)
    for (const el of container.querySelectorAll('dl div')) expect(el.className).not.toMatch(/glass|backdrop|blur/)
    for (const el of container.querySelectorAll('.tag-chip')) expect(el.className).toContain('on-glass')
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

  it('aucune carte : message habituel, pas de bouton d’étude, tous les tags grisés', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    renderHome(ready({ today: 0, due: 0, fresh: 0, mastered: 0, total: 0, tags: TAGS.map(t => ({ ...t, count: 0, today: 0 })) }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("Aucune carte pour l'instant. Lance /flashcards sur le Mac.")
    expect(screen.queryByRole('button', { name: /Commencer|Réviser/ })).toBeNull()
    const tags = within(within(screen.getByRole('region', { name: 'Mes tags' })).getByRole('list')).getAllByRole('button')
    expect(tags.every(b => b.getAttribute('aria-disabled') === 'true')).toBe(true)
  })

  it('chargement puis erreur de lecture du cache', () => {
    const { rerender } = renderHome({ status: 'loading' })
    expect(screen.queryByRole('button', { name: 'Commencer à étudier' })).toBeNull()
    rerender(<KApp theme="ios"><HomeScreen data={{ status: 'error' }} now={now} onStudy={vi.fn()} onReviewAll={vi.fn()} onOpenTags={vi.fn()} /></KApp>)
    expect(screen.getByRole('alert').textContent).toBe('Impossible de lire les cartes enregistrées sur cet appareil.')
  })
})
