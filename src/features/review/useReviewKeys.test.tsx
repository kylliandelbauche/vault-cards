import { describe, it, expect, vi } from 'vitest'
import { renderHook, fireEvent } from '@testing-library/react'
import { useReviewKeys } from './useReviewKeys'

const session = (revealed: boolean, status: 'reviewing' | 'done' = 'reviewing') =>
  ({ status, revealed, reveal: vi.fn(), rate: vi.fn() })

describe('useReviewKeys', () => {
  it('Espace et Entrée révèlent la réponse', () => {
    const s = session(false)
    renderHook(() => useReviewKeys(s))
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(s.reveal).toHaveBeenCalledTimes(2)
    expect(s.rate).not.toHaveBeenCalled()
  })
  it('1 / 2 / 3 notent une fois la réponse révélée', () => {
    const s = session(true)
    renderHook(() => useReviewKeys(s))
    for (const key of ['1', '2', '3']) fireEvent.keyDown(window, { key })
    expect(s.rate.mock.calls).toEqual([[1], [2], [3]])
  })
  it('ignore les touches hors session et avec modificateur', () => {
    const done = session(true, 'done')
    renderHook(() => useReviewKeys(done))
    fireEvent.keyDown(window, { key: '1' })
    expect(done.rate).not.toHaveBeenCalled()
    const s = session(true)
    renderHook(() => useReviewKeys(s))
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    expect(s.rate).not.toHaveBeenCalled()
  })
})
