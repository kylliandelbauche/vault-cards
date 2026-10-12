import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useReviewSession, memoryStore } from './useReviewSession'
import type { Card } from '../../lib/types'

const cards: Card[] = ['a', 'b'].map(id => ({ id, deck: 'x', source_path: `x/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null }))
const fixedNow = () => new Date('2026-10-12T10:00:00Z')

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
})
