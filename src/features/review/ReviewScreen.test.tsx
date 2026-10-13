import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { stateFromReviews } from '../../lib/scheduler'
import type { Card } from '../../lib/types'
import { ReviewScreen } from './ReviewScreen'
import type { SyncIndicator } from './useAutoSync'
import type { ReviewSession } from './useReviewSession'

const card: Card = { id: 'a', deck: 'd', tags: ['ia'], source_path: 'd/a.md', front: 'Question ?', back: 'Réponse.', updated_at: '2026-10-13T00:00:00+00:00', deleted_at: null }
const now = () => new Date('2026-10-13T10:00:00Z')

const session = (over: Partial<ReviewSession> = {}): ReviewSession => ({
  status: 'empty', current: null, revealed: false, saveFailed: false, reveal: vi.fn(), rate: vi.fn(),
  counts: { new: 0, learn: 0, due: 0 }, progress: 0, stats: { again: 0, hard: 0, good: 0 }, nextDueAt: null, restart: vi.fn(), reviewAll: vi.fn(),
  ...over,
})
const reviewing = (over: Partial<ReviewSession> = {}) =>
  session({ status: 'reviewing', current: { card, state: stateFromReviews([]) }, counts: { new: 1, learn: 0, due: 0 }, ...over })

const renderScreen = (s: ReviewSession, sync: SyncIndicator = 'synced') =>
  render(<KApp theme="ios"><ReviewScreen session={s} now={now} sync={sync} /></KApp>)

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ReviewScreen', () => {
  it.each([
    ['synced', 'Synchronisé'],
    ['unsynced', 'Non synchronisé'],
    ['syncing', 'Synchronisation…'],
  ] as const)('indicateur de synchro toujours visible : %s → « %s »', (sync, label) => {
    renderScreen(reviewing(), sync)
    expect(screen.getByRole('status').textContent).toBe(label)
  })

  it('« Réviser à nouveau » lance la révision libre', async () => {
    const s = session({ status: 'done', stats: { again: 0, hard: 0, good: 2 } })
    renderScreen(s)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réviser à nouveau' }))
    expect(s.reviewAll).toHaveBeenCalledTimes(1)
    expect(s.restart).not.toHaveBeenCalled()
  })

  it('premier lancement hors ligne sans cache : invite à se connecter', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderScreen(session({ status: 'empty' }))
    expect(screen.getByText('Connecte-toi à internet pour la première synchronisation.')).toBeTruthy()
  })

  it('aucune carte en ligne : message habituel', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    renderScreen(session({ status: 'empty' }))
    expect(screen.getByText("Aucune carte pour l'instant. Lance /flashcards sur le Mac.")).toBeTruthy()
  })

  it('lecture du cache en échec : message et bouton Réessayer', async () => {
    const s = session({ status: 'error' })
    renderScreen(s)
    expect(screen.getByRole('alert').textContent).toBe('Impossible de lire les cartes enregistrées sur cet appareil.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(s.restart).toHaveBeenCalledTimes(1)
  })

  it('note non enregistrée : message court, la barre de notation reste', () => {
    renderScreen(reviewing({ revealed: true, saveFailed: true }))
    expect(screen.getByRole('alert').textContent).toBe('Note non enregistrée. Réessaie.')
    expect(screen.getByRole('button', { name: /Très bien/ })).toBeTruthy()
  })

  it('emplacement d’action unique, avant révélation : seulement « Afficher la réponse »', async () => {
    const s = reviewing()
    renderScreen(s)
    const actions = within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button')
    expect(actions.map(b => b.textContent)).toEqual(['Afficher la réponse'])
    expect(screen.queryByRole('button', { name: /Je ne sais pas|Moyen|Très bien/ })).toBeNull()
    await userEvent.setup().click(actions[0])
    expect(s.reveal).toHaveBeenCalledTimes(1)
  })

  it('emplacement d’action unique, après révélation : les 3 notations au même endroit', async () => {
    const s = reviewing({ revealed: true })
    renderScreen(s)
    expect(screen.getAllByRole('group', { name: 'Actions' })).toHaveLength(1)
    const actions = within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button')
    expect(actions.map(b => b.textContent?.replace(/\d.*$/, ''))).toEqual(['Je ne sais pas', 'Moyen', 'Très bien'])
    expect(screen.queryByRole('button', { name: 'Afficher la réponse' })).toBeNull()
    await userEvent.setup().click(actions[2])
    expect(s.rate).toHaveBeenCalledWith(3)
  })

  it('notation : appui sans opacité sur le texte, cibles ≥ 44 px', () => {
    renderScreen(reviewing({ revealed: true }))
    for (const b of within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button')) {
      expect(b.className).not.toMatch(/opacity/)
      expect(b.className).toMatch(/active:bg-(again|hard|good)-fill-pressed/)
      expect(b.className).toMatch(/min-h-14/)
    }
  })

  it('compteurs lisibles par VoiceOver : le libellé est dans le texte, pas dans un aria-label', () => {
    renderScreen(reviewing({ counts: { new: 12, learn: 3, due: 40 } }))
    for (const label of ['12 nouvelles', '3 à revoir', '40 dues']) {
      const pill = screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === label)
      expect(pill.hasAttribute('aria-label')).toBe(false)
      expect(pill.hasAttribute('title')).toBe(false)
    }
  })

  it('indicateur de synchro : texte opaque, point animé seulement si les animations sont permises', () => {
    renderScreen(reviewing(), 'syncing')
    const badge = screen.getByRole('status')
    expect(badge.className).not.toMatch(/opacity/)
    expect(badge.parentElement?.className ?? '').not.toMatch(/opacity/)
    const dot = badge.querySelector('[aria-hidden]')!
    expect(dot.className).toMatch(/motion-safe:animate-pulse/)
    expect(dot.className.split(' ')).not.toContain('animate-pulse')
  })

  it('barres en verre superposées au contenu, marges de zone sûre gauche/droite', () => {
    const { container } = renderScreen(reviewing())
    const header = container.querySelector('header')!
    const footer = container.querySelector('footer')!
    for (const bar of [header, footer]) {
      expect(bar.className).toMatch(/\bsticky\b/)
      expect(bar.className).toMatch(/--k-safe-area-left/)
      expect(bar.className).toMatch(/--k-safe-area-right/)
      expect(bar.querySelector('.glass')).toBeTruthy()
    }
    expect(container.querySelector('main')!.className).toMatch(/--k-safe-area-left/)
    // Carte en verre (#40) : 3 surfaces floutées au total (2 barres + la carte), aucune imbriquée.
    expect(container.querySelector('main .glass')).toBeNull()
    expect(container.querySelectorAll('main .glass-card')).toHaveLength(1)
    expect(container.querySelectorAll('.glass, .glass-card')).toHaveLength(3)
    expect(container.querySelectorAll('.glass .glass, .glass .glass-card, .glass-card .glass, .glass-card .glass-card')).toHaveLength(0)
  })

  it('bouton de déconnexion dans la barre du haut : étiqueté, cible 44 px, appelle onSignOut', async () => {
    const onSignOut = vi.fn()
    const { container } = render(<KApp theme="ios"><ReviewScreen session={reviewing()} now={now} sync="synced" onSignOut={onSignOut} /></KApp>)
    const btn = within(container.querySelector('header')!).getByRole('button', { name: 'Déconnexion' })
    expect(btn.className).toMatch(/\bsize-11\b/)
    await userEvent.setup().click(btn)
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('sans onSignOut : pas de bouton de déconnexion', () => {
    renderScreen(reviewing())
    expect(screen.queryByRole('button', { name: 'Déconnexion' })).toBeNull()
  })
})
