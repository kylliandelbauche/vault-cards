/**
 * Délai maximal d'une requête Supabase. Sans lui, une requête qui s'enlise (réseau, PWA iOS suspendue en plein
 * sync) garderait le verrou de synchro de tous les onglets indéfiniment ; avec lui, elle échoue comme une
 * coupure réseau : le sync rejette, les reviews restent `synced: 0` et repartent au prochain essai.
 */
export const REQUEST_TIMEOUT_MS = 30_000

/** `fetch` dont chaque requête est annulée (TimeoutError) si elle n'a pas répondu après `ms`. */
export function withTimeout(fetchImpl: typeof fetch, ms = REQUEST_TIMEOUT_MS): typeof fetch {
  return (input, init = {}) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(new DOMException('Délai de la requête dépassé', 'TimeoutError')), ms)
    const outer = init.signal
    if (outer?.aborted) ctrl.abort(outer.reason)
    else outer?.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true })
    return fetchImpl(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
  }
}
