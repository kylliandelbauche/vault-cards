import { describe, it, expect, vi } from 'vitest'
import { safeSignOut } from './safeSignOut'

const deps = (counts: number[], over: Partial<Parameters<typeof safeSignOut>[0]> = {}) => {
  const queue = [...counts]
  return {
    pending: vi.fn(async () => queue.length > 1 ? queue.shift()! : queue[0]),
    sync: vi.fn(async () => {}),
    confirm: vi.fn(() => true),
    signOut: vi.fn(),
    ...over,
  }
}

describe('safeSignOut', () => {
  it('rien en attente : signOut direct, sans synchro ni confirmation', async () => {
    const d = deps([0])
    expect(await safeSignOut(d)).toBe(true)
    expect(d.signOut).toHaveBeenCalledTimes(1)
    expect(d.sync).not.toHaveBeenCalled()
    expect(d.confirm).not.toHaveBeenCalled()
  })

  it('en attente puis synchro réussie : déconnecte sans confirmation', async () => {
    const d = deps([3, 0])
    expect(await safeSignOut(d)).toBe(true)
    expect(d.sync).toHaveBeenCalledTimes(1)
    expect(d.confirm).not.toHaveBeenCalled()
    expect(d.signOut).toHaveBeenCalledTimes(1)
  })

  it('synchro en échec : demande confirmation ; annulation = pas de déconnexion', async () => {
    const d = deps([2], { sync: vi.fn(async () => { throw new Error('offline') }), confirm: vi.fn(() => false) })
    expect(await safeSignOut(d)).toBe(false)
    expect(d.confirm).toHaveBeenCalledWith(expect.stringContaining('2 modifications pas encore synchronisées (révisions, cartes) seront perdues'))
    expect(d.signOut).not.toHaveBeenCalled()
  })

  it('synchro en échec et confirmation acceptée : déconnecte', async () => {
    const d = deps([1], { sync: vi.fn(async () => { throw new Error('offline') }) })
    expect(await safeSignOut(d)).toBe(true)
    expect(d.confirm).toHaveBeenCalledWith(expect.stringContaining('1 modification pas encore synchronisée (révision ou carte) sera perdue'))
    expect(d.signOut).toHaveBeenCalledTimes(1)
  })
})
