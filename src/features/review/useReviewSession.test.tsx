import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useReviewSession, memoryStore, SCREEN_CHANGE_GUARD_MS } from './useReviewSession'
import type { Card } from '../../lib/types'

const cards: Card[] = ['a', 'b'].map(id => ({ id, deck: 'x', source_path: `x/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null }))
// Horloge qui avance d'une seconde à chaque lecture : chaque action tombe après la garde anti double tap.
const START = Date.parse('2026-10-12T10:00:00Z')
let tick = 0
const fixedNow = () => new Date(START + 1000 * tick++)

describe('useReviewSession', () => {
  it('révéler puis noter passe à la carte suivante', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    const first = result.current.current!.card.id
    act(() => result.current.reveal())
    await act(async () => result.current.rate(3))
    expect(result.current.current!.card.id).not.toBe(first)
    expect(result.current.revealed).toBe(false)
  })
  it('noter sans avoir révélé ne fait rien', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    await act(async () => result.current.rate(3))
    expect((await store.loadReviews())).toHaveLength(0)
  })
  it('double tap : une seule review', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reveal())
    await act(async () => { result.current.rate(3); result.current.rate(3) })
    expect((await store.loadReviews())).toHaveLength(1)
  })
  it('« Je ne sais pas » remet la carte en fin de session', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    const first = result.current.current!.card.id
    act(() => result.current.reveal()); await act(async () => result.current.rate(1))
    act(() => result.current.reveal()); await act(async () => result.current.rate(3))
    expect(result.current.current!.card.id).toBe(first)
  })
  it('fin de session : status done + stats', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    for (let i = 0; i < cards.length; i++) { act(() => result.current.reveal()); await act(async () => result.current.rate(3)) }
    expect(result.current.status).toBe('done')
    expect(result.current.stats).toEqual({ again: 0, hard: 0, good: 2 })
  })
  it('aucune carte : status empty', async () => {
    const { result } = renderHook(() => useReviewSession(memoryStore([]), fixedNow))
    await waitFor(() => expect(result.current.status).toBe('empty'))
  })

  it('un store recréé à chaque rendu ne relance pas le chargement', async () => {
    let loads = 0
    const make = () => ({ ...memoryStore(cards), loadCards: async () => { loads++; return cards } })
    const { result } = renderHook(() => useReviewSession(make(), fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reveal())
    expect(loads).toBe(1)
  })

  describe('garde anti double tap entre révéler et noter', () => {
    // Horloge pilotée à la main pour placer chaque tap à la milliseconde près.
    let t = START
    const clock = () => new Date(t)
    const setup = async () => {
      t = START
      const store = memoryStore(cards)
      const hook = renderHook(() => useReviewSession(store, clock))
      await waitFor(() => expect(hook.result.current.status).toBe('reviewing'))
      return { store, result: hook.result }
    }

    it('une note juste après la révélation est ignorée (aucune review)', async () => {
      const { store, result } = await setup()
      t += 1000
      act(() => result.current.reveal())
      t += SCREEN_CHANGE_GUARD_MS - 1
      await act(async () => result.current.rate(2))
      expect(await store.loadReviews()).toHaveLength(0)
      expect(result.current.revealed).toBe(true)
    })
    it('une note après le délai est enregistrée', async () => {
      const { store, result } = await setup()
      t += 1000
      act(() => result.current.reveal())
      t += SCREEN_CHANGE_GUARD_MS
      await act(async () => result.current.rate(2))
      expect(await store.loadReviews()).toHaveLength(1)
    })
    it('une révélation juste après une note est ignorée', async () => {
      const { result } = await setup()
      t += 1000
      act(() => result.current.reveal())
      t += 1000
      await act(async () => result.current.rate(3))
      const next = result.current.current!.card.id
      t += SCREEN_CHANGE_GUARD_MS - 1
      act(() => result.current.reveal())
      expect(result.current.revealed).toBe(false)
      t += 1
      act(() => result.current.reveal())
      expect(result.current.revealed).toBe(true)
      expect(result.current.current!.card.id).toBe(next)
    })
  })
})
