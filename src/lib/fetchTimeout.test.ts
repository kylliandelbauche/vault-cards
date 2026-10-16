import { describe, it, expect, vi, afterEach } from 'vitest'
import { REQUEST_TIMEOUT_MS, UPLOAD_TIMEOUT_MS, isUpload, withTimeout } from './fetchTimeout'

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

describe('envoi de fichier vers Storage (#55)', () => {
  it('isUpload : POST/PUT sur /storage/v1/object/ seulement', () => {
    expect(isUpload('https://x.supabase.co/storage/v1/object/inbox/u/i', { method: 'POST' })).toBe(true)
    expect(isUpload(new URL('https://x.supabase.co/storage/v1/object/inbox/u/i'), { method: 'PUT' })).toBe(true)
    expect(isUpload('https://x.supabase.co/storage/v1/object/inbox/u/i', { method: 'GET' })).toBe(false)
    expect(isUpload('https://x.supabase.co/storage/v1/object/inbox/u/i')).toBe(false)
    expect(isUpload('https://x.supabase.co/rest/v1/inbox', { method: 'POST' })).toBe(false)
  })

  it('un envoi de fichier a un délai plus long (gros PDF sur réseau mobile) ; il finit quand même par échouer', async () => {
    vi.useFakeTimers()
    const p = withTimeout(hangingFetch)('https://x.test/storage/v1/object/inbox/u/i', { method: 'POST' })
    let done = false
    const settled = expect(p.finally(() => { done = true })).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - REQUEST_TIMEOUT_MS)
    await settled
  })
})
