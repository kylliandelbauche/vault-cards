import { describe, it, expect, vi, afterEach } from 'vitest'
import { REQUEST_TIMEOUT_MS, withTimeout } from './fetchTimeout'

/** Faux fetch qui ne répond jamais, mais rejette quand son signal est annulé (comme le vrai). */
const hangingFetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  }))

afterEach(() => { vi.useRealTimers(); hangingFetch.mockClear() })

describe('withTimeout', () => {
  it('requête bloquée : rejetée après le délai (TimeoutError), le sync échoue normalement et libère le verrou', async () => {
    vi.useFakeTimers()
    const p = withTimeout(hangingFetch)('https://x.test/rest/v1/reviews')
    const settled = expect(p).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    await settled
  })

  it('réponse avant le délai : renvoyée telle quelle, le minuteur est annulé', async () => {
    vi.useFakeTimers()
    const ok = new Response('[]')
    const f = withTimeout(vi.fn(async () => ok), 1000)
    await expect(f('https://x.test')).resolves.toBe(ok)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('le signal de l’appelant (supabase-js) annule toujours la requête', async () => {
    const outer = new AbortController()
    const p = withTimeout(hangingFetch, 60_000)('https://x.test', { signal: outer.signal })
    outer.abort(new Error('annulé'))
    await expect(p).rejects.toThrow('annulé')
  })
})
