import { describe, it, expect } from 'vitest'
import { followColorScheme } from './theme'

/** MediaQueryList minimal dont on pilote `matches` et l'événement `change`. */
function fakeQuery(initial: boolean) {
  const listeners = new Set<() => void>()
  const mql = {
    matches: initial,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  const set = (v: boolean) => { mql.matches = v; listeners.forEach(l => l()) }
  return { mql: mql as unknown as MediaQueryList, set, listeners }
}

describe('followColorScheme', () => {
  it('pose `.dark` selon l’appareil et bascule en direct quand le thème change', () => {
    const root = document.createElement('html')
    const q = fakeQuery(false)
    const stop = followColorScheme(root, q.mql)
    expect(root.classList.contains('dark')).toBe(false)
    q.set(true)
    expect(root.classList.contains('dark')).toBe(true)
    q.set(false)
    expect(root.classList.contains('dark')).toBe(false)
    stop()
    expect(q.listeners.size).toBe(0)
  })

  it('démarre en sombre si l’appareil est déjà en sombre', () => {
    const root = document.createElement('html')
    followColorScheme(root, fakeQuery(true).mql)
    expect(root.classList.contains('dark')).toBe(true)
  })
})
