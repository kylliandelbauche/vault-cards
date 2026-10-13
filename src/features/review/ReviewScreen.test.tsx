import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
})
