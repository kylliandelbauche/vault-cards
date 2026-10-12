import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { VaultDB } from '../../lib/db'
import { useAutoSync, usePendingCount, type AutoSyncSession } from './useAutoSync'

type Result = { pushed: number; pulledCards: number; pulledReviews: number }
const NOTHING: Result = { pushed: 0, pulledCards: 0, pulledReviews: 0 }
const CARDS: Result = { pushed: 0, pulledCards: 3, pulledReviews: 0 }

const ZERO = { again: 0, hard: 0, good: 0 }
const sessionIn = (status: AutoSyncSession['status'], stats = ZERO, restart = vi.fn()): AutoSyncSession =>
  ({ status, stats, restart })

/** Promesse résolue à la main, pour finir un sync au moment voulu. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

describe('useAutoSync', () => {
  it('synchronise au montage et à chaque retour du réseau', async () => {
    const run = vi.fn().mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    act(() => { window.dispatchEvent(new Event('online')) })
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('synchronise quand la session passe à done', async () => {
    const run = vi.fn().mockResolvedValue(NOTHING)
    const { rerender } = renderHook(({ s }) => useAutoSync(s, run), { initialProps: { s: sessionIn('reviewing') } })
    await flush()
    rerender({ s: sessionIn('done', { again: 0, hard: 0, good: 2 }) })
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('avale les erreurs de sync et réessaie au prochain déclencheur', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('hors ligne')).mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    await flush()
    act(() => { window.dispatchEvent(new Event('online')) })
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('les déclencheurs pendant un sync en cours donnent un seul sync de plus', async () => {
    const first = deferred<Result>()
    const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    act(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('online'))
    })
    expect(run).toHaveBeenCalledTimes(1)
    await act(async () => { first.resolve(NOTHING) })
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('session vide + cartes reçues : recharge la session', async () => {
    const s = sessionIn('empty')
    renderHook(() => useAutoSync(s, vi.fn().mockResolvedValue(CARDS)))
    await flush()
    expect(s.restart).toHaveBeenCalledTimes(1)
  })

  it('rien reçu : ne recharge pas', async () => {
    const s = sessionIn('empty')
    renderHook(() => useAutoSync(s, vi.fn().mockResolvedValue(NOTHING)))
    await flush()
    expect(s.restart).not.toHaveBeenCalled()
  })

  it('sync fini pendant le chargement initial, chargement vide ensuite : recharge', async () => {
    const restart = vi.fn()
    const { rerender } = renderHook(({ s }) => useAutoSync(s, vi.fn().mockResolvedValue(CARDS)),
      { initialProps: { s: sessionIn('loading', ZERO, restart) } })
    await flush()
    expect(restart).not.toHaveBeenCalled()
    rerender({ s: sessionIn('empty', ZERO, restart) })
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('ouverture sans rien à réviser dans le cache (done, aucune note) : recharge', async () => {
    const s = sessionIn('done')
    renderHook(() => useAutoSync(s, vi.fn().mockResolvedValue(CARDS)))
    await flush()
    expect(s.restart).toHaveBeenCalledTimes(1)
  })

  it('fin d’une vraie session (done avec des notes) : ne recharge pas, le bilan reste affiché', async () => {
    const s = sessionIn('done', { again: 1, hard: 0, good: 4 })
    renderHook(() => useAutoSync(s, vi.fn().mockResolvedValue(CARDS)))
    await flush()
    expect(s.restart).not.toHaveBeenCalled()
  })

  it('session en cours : ne recharge pas', async () => {
    const s = sessionIn('reviewing')
    renderHook(() => useAutoSync(s, vi.fn().mockResolvedValue(CARDS)))
    await flush()
    expect(s.restart).not.toHaveBeenCalled()
  })
})

describe('usePendingCount', () => {
  let db: VaultDB
  beforeEach(() => { db = new VaultDB('test-' + crypto.randomUUID()) })
  afterEach(async () => { await db.delete() })

  it('suit le nombre de reviews à pousser', async () => {
    const { result } = renderHook(() => usePendingCount(db))
    await waitFor(() => expect(result.current).toBe(0))
    await act(async () => { await db.reviews.add({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z', synced: 0 }) })
    await waitFor(() => expect(result.current).toBe(1))
    await act(async () => { await db.reviews.update('r1', { synced: 1 }) })
    await waitFor(() => expect(result.current).toBe(0))
  })
})
