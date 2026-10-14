import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { VaultDB } from '../../lib/db'
import { SyncError } from '../../lib/sync'
import { RESUME_SYNC_MIN_INTERVAL_MS, SKIPPED_RETRY_MS, syncIndicator, useAutoSync, usePendingCount, type AutoSyncSession } from './useAutoSync'

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

  it('push en échec mais cartes tirées (SyncError) : recharge la session vide, indicateur en échec', async () => {
    const s = sessionIn('empty')
    const { result } = renderHook(() => useAutoSync(s, vi.fn().mockRejectedValue(new SyncError({ ...CARDS }, [new Error('réseau coupé')]))))
    await flush()
    expect(s.restart).toHaveBeenCalledTimes(1)
    expect(result.current.lastSync).toBe('failed')
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

describe('useAutoSync : état du dernier sync', () => {
  it('syncing pendant le sync, puis ok', async () => {
    const d = deferred<Result>()
    const { result } = renderHook(() => useAutoSync(sessionIn('reviewing'), vi.fn().mockReturnValue(d.promise)))
    await waitFor(() => expect(result.current).toMatchObject({ syncing: true, lastSync: null }))
    await act(async () => { d.resolve(NOTHING) })
    expect(result.current).toMatchObject({ syncing: false, lastSync: 'ok' })
  })
  it('échec : failed', async () => {
    const { result } = renderHook(() => useAutoSync(sessionIn('reviewing'), vi.fn().mockRejectedValue(new Error('hors ligne'))))
    await waitFor(() => expect(result.current).toMatchObject({ syncing: false, lastSync: 'failed' }))
  })
})

describe('syncIndicator', () => {
  it.each([
    [0, { syncing: false, lastSync: 'ok' }, 'synced'],
    [2, { syncing: false, lastSync: 'ok' }, 'unsynced'],
    [0, { syncing: false, lastSync: 'failed' }, 'unsynced'],
    [0, { syncing: false, lastSync: null }, 'unsynced'],
    [3, { syncing: true, lastSync: 'failed' }, 'syncing'],
    [null, { syncing: false, lastSync: 'ok' }, 'unsynced'],
  ] as const)('%s en attente, %o → %s', (pending, state, expected) => {
    expect(syncIndicator(pending, state)).toBe(expected)
  })
})

describe('useAutoSync : retour au premier plan', () => {
  const T0 = Date.parse('2026-10-13T10:00:00Z')
  let visibility: DocumentVisibilityState = 'visible'
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  const mount = async () => {
    const run = vi.fn().mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    await flush()
    expect(run).toHaveBeenCalledTimes(1) // sync au montage, à T0
    return run
  }
  const show = () => act(() => { document.dispatchEvent(new Event('visibilitychange')) })
  const focus = () => act(() => { window.dispatchEvent(new Event('focus')) })

  it('page redevenue visible après l’intervalle minimum : sync', async () => {
    const run = await mount()
    vi.setSystemTime(T0 + RESUME_SYNC_MIN_INTERVAL_MS)
    show()
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('focus après l’intervalle minimum : sync ; focus + visibilitychange ensemble : un seul', async () => {
    const run = await mount()
    vi.setSystemTime(T0 + RESUME_SYNC_MIN_INTERVAL_MS + 5000)
    show()
    focus()
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('avant l’intervalle minimum : rien', async () => {
    const run = await mount()
    vi.setSystemTime(T0 + RESUME_SYNC_MIN_INTERVAL_MS - 1)
    show()
    focus()
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('page masquée : rien', async () => {
    const run = await mount()
    vi.setSystemTime(T0 + 10 * RESUME_SYNC_MIN_INTERVAL_MS)
    visibility = 'hidden'
    show()
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('sync en échec : ne compte pas pour l’intervalle, on réessaie au prochain retour au premier plan (#22)', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('hors ligne')).mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    await flush()
    expect(run).toHaveBeenCalledTimes(1) // montage, en échec
    vi.setSystemTime(T0 + 1000)
    show()
    await flush()
    expect(run).toHaveBeenCalledTimes(2) // réessai tout de suite, réussi
    vi.setSystemTime(T0 + 2000)
    show()
    await flush()
    expect(run).toHaveBeenCalledTimes(2) // dernier sync réussi il y a 1 s : rien
  })

  it('sync partiel (SyncError) : compte comme un échec pour l’intervalle', async () => {
    const run = vi.fn().mockRejectedValueOnce(new SyncError({ ...NOTHING }, [new Error('réseau coupé')])).mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    await flush()
    vi.setSystemTime(T0 + 1000)
    focus()
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('démontage : les listeners (réseau, premier plan, focus) sont retirés', async () => {
    const run = vi.fn().mockResolvedValue(NOTHING)
    const { unmount } = renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    await flush()
    unmount()
    vi.setSystemTime(T0 + 10 * RESUME_SYNC_MIN_INTERVAL_MS)
    show()
    focus()
    act(() => { window.dispatchEvent(new Event('online')) })
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('jamais deux syncs en parallèle', async () => {
    const d = deferred<Result>()
    const run = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    vi.setSystemTime(T0 + RESUME_SYNC_MIN_INTERVAL_MS)
    show()
    focus()
    expect(run).toHaveBeenCalledTimes(1) // le sync de montage est en cours : rien en parallèle
    await act(async () => { d.resolve(NOTHING) })
    await flush()
    expect(run).toHaveBeenCalledTimes(2) // un seul sync de plus, lancé après la fin du premier
  })
})

describe('useAutoSync : un seul sync entre onglets (Web Locks)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  /** Faux navigator.locks dont le verrou est déjà tenu (ou non) par un autre onglet. */
  const stubLocks = (heldElsewhere: boolean) => {
    const request = vi.fn((_name: string, _opts: LockOptions, cb: (lock: Lock | null) => unknown) =>
      Promise.resolve(cb(heldElsewhere ? null : { name: 'vault-cards-sync', mode: 'exclusive' })))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    return request
  }

  it('verrou libre : le sync passe sous le verrou « vault-cards-sync »', async () => {
    const request = stubLocks(false)
    const run = vi.fn().mockResolvedValue(NOTHING)
    const { result } = renderHook(() => useAutoSync(sessionIn('reviewing'), run))
    await flush()
    expect(request).toHaveBeenCalledWith('vault-cards-sync', { ifAvailable: true }, expect.any(Function))
    expect(run).toHaveBeenCalledTimes(1)
    expect(result.current.lastSync).toBe('ok')
  })

  it('verrou tenu par un autre onglet : pas de sync, ni ok ni échec, rien à recharger', async () => {
    stubLocks(true)
    const s = sessionIn('empty')
    const run = vi.fn().mockResolvedValue(CARDS)
    const { result } = renderHook(() => useAutoSync(s, run))
    await flush()
    expect(run).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ syncing: false, lastSync: null })
    expect(s.restart).not.toHaveBeenCalled()
  })
})

describe('useAutoSync : sync sauté (autre onglet) avec des notes en attente (#22)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  /** Verrou tenu ailleurs pour les `busy` premières demandes, libre ensuite. */
  const stubLocks = (busy: number) => {
    let calls = 0
    vi.stubGlobal('navigator', { ...navigator, locks: { request: vi.fn((_n: string, _o: LockOptions, cb: (l: Lock | null) => unknown) =>
      Promise.resolve(cb(calls++ < busy ? null : { name: 'vault-cards-sync', mode: 'exclusive' }))) } })
  }
  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

  it('notes en attente : un seul réessai après SKIPPED_RETRY_MS', async () => {
    vi.useFakeTimers()
    stubLocks(1)
    const run = vi.fn().mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run, { pending: async () => 2 }))
    await tick(0)
    expect(run).not.toHaveBeenCalled()
    await tick(SKIPPED_RETRY_MS - 1)
    expect(run).not.toHaveBeenCalled()
    await tick(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('réessai sauté lui aussi : pas d’autre réessai (une fois seulement)', async () => {
    vi.useFakeTimers()
    stubLocks(10)
    const run = vi.fn().mockResolvedValue(NOTHING)
    const pending = vi.fn(async () => 1)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run, { pending }))
    await tick(10 * SKIPPED_RETRY_MS)
    expect(run).not.toHaveBeenCalled()
    expect(pending).toHaveBeenCalledTimes(1)
  })

  it('rien en attente : pas de réessai ; démontage : le réessai prévu est annulé', async () => {
    vi.useFakeTimers()
    stubLocks(1)
    const run = vi.fn().mockResolvedValue(NOTHING)
    renderHook(() => useAutoSync(sessionIn('reviewing'), run, { pending: async () => 0 }))
    await tick(2 * SKIPPED_RETRY_MS)
    expect(run).not.toHaveBeenCalled()

    stubLocks(1)
    const { unmount } = renderHook(() => useAutoSync(sessionIn('reviewing'), run, { pending: async () => 3 }))
    await tick(0)
    unmount()
    await tick(2 * SKIPPED_RETRY_MS)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('usePendingCount', () => {
  let db: VaultDB
  beforeEach(() => { db = new VaultDB('test-' + crypto.randomUUID()) })
  afterEach(async () => { await db.delete() })

  it('suit le nombre de reviews à pousser', async () => {
    const { result } = renderHook(() => usePendingCount(db))
    expect(result.current).toBeNull() // pas encore compté
    await waitFor(() => expect(result.current).toBe(0))
    await act(async () => { await db.reviews.add({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z', synced: 0 }) })
    await waitFor(() => expect(result.current).toBe(1))
    await act(async () => { await db.reviews.update('r1', { synced: 1 }) })
    await waitFor(() => expect(result.current).toBe(0))
  })
})

describe('useAutoSync : écran d’accueil (#53)', () => {
  it('session idle : un sync qui ramène des données ne relance aucune session', async () => {
    const restart = vi.fn()
    const run = vi.fn().mockResolvedValue(CARDS)
    renderHook(() => useAutoSync(sessionIn('idle', ZERO, restart), run))
    await flush()
    expect(run).toHaveBeenCalledTimes(1)
    expect(restart).not.toHaveBeenCalled()
  })

  it('syncNow() lance un sync tout de suite', async () => {
    const run = vi.fn().mockResolvedValue(NOTHING)
    const { result } = renderHook(() => useAutoSync(sessionIn('idle'), run))
    await flush()
    act(() => result.current.syncNow())
    await flush()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
