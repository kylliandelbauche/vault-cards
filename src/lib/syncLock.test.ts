import { describe, it, expect, vi } from 'vitest'
import { SKIPPED, SYNC_LOCK, withSyncLock } from './syncLock'

/** Faux navigator.locks : un seul détenteur à la fois, `ifAvailable` → null si déjà pris. */
function fakeLocks() {
  const held = new Set<string>()
  const request = vi.fn(async (name: string, options: LockOptions, cb: (lock: Lock | null) => unknown) => {
    if (held.has(name)) return cb(null)
    expect(options).toEqual({ ifAvailable: true })
    held.add(name)
    try { return await cb({ name, mode: 'exclusive' }) } finally { held.delete(name) }
  })
  return { request, held } as unknown as Pick<LockManager, 'request'> & { held: Set<string>; request: typeof request }
}

describe('withSyncLock', () => {
  it('verrou libre : lance la fonction sous le verrou et renvoie son résultat', async () => {
    const locks = fakeLocks()
    const fn = vi.fn(async () => (locks.held.has(SYNC_LOCK) ? 'sous verrou' : 'sans verrou'))
    await expect(withSyncLock(fn, locks)).resolves.toBe('sous verrou')
    expect(locks.request).toHaveBeenCalledWith(SYNC_LOCK, { ifAvailable: true }, expect.any(Function))
  })

  it('verrou pris par un autre onglet : ne lance rien, renvoie SKIPPED sans attendre', async () => {
    const locks = fakeLocks()
    locks.held.add(SYNC_LOCK)
    const fn = vi.fn(async () => 'x')
    await expect(withSyncLock(fn, locks)).resolves.toBe(SKIPPED)
    expect(fn).not.toHaveBeenCalled()
  })

  it('deux syncs simultanés (deux onglets) : un seul passe', async () => {
    const locks = fakeLocks()
    let release!: () => void
    const slow = vi.fn(() => new Promise<string>(r => { release = () => r('fini') }))
    const first = withSyncLock(slow, locks)
    await Promise.resolve()
    await expect(withSyncLock(vi.fn(async () => 'second'), locks)).resolves.toBe(SKIPPED)
    release()
    await expect(first).resolves.toBe('fini')
    await expect(withSyncLock(vi.fn(async () => 'après'), locks)).resolves.toBe('après') // verrou relâché
  })

  it('le verrou est relâché même si le sync échoue', async () => {
    const locks = fakeLocks()
    await expect(withSyncLock(async () => { throw new Error('hors ligne') }, locks)).rejects.toThrow('hors ligne')
    expect(locks.held.size).toBe(0)
  })

  it('sans Web Locks : repli, la fonction est lancée directement', async () => {
    await expect(withSyncLock(async () => 'ok', null)).resolves.toBe('ok')
  })
})
