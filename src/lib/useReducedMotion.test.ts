import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useReducedMotion } from './useReducedMotion'

afterEach(() => vi.unstubAllGlobals())

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const mql = {
    matches: initial,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  const matchMedia = vi.fn(() => mql)
  vi.stubGlobal('matchMedia', matchMedia)
  return { set: (v: boolean) => { mql.matches = v; listeners.forEach(l => l()) }, listeners, matchMedia }
}

describe('useReducedMotion', () => {
  it('suit « Réduire les animations » en direct et se désabonne au démontage', () => {
    const q = stubMatchMedia(false)
    const { result, unmount } = renderHook(() => useReducedMotion())
    expect(q.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
    expect(result.current).toBe(false)
    act(() => q.set(true))
    expect(result.current).toBe(true)
    unmount()
    expect(q.listeners.size).toBe(0)
  })

  it('sans matchMedia : animations permises', () => {
    vi.stubGlobal('matchMedia', undefined)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})
