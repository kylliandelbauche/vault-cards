/**
 * Délai maximal d'une requête Supabase. Sans lui, une requête qui s'enlise (réseau, PWA iOS suspendue en plein
 * sync) garderait le verrou de synchro de tous les onglets indéfiniment ; avec lui, elle échoue comme une
 * coupure réseau : le sync rejette, les reviews restent `synced: 0` et repartent au prochain essai.
 */
export const REQUEST_TIMEOUT_MS = 30_000

/**
 * Délai d'un envoi de fichier vers Storage (boîte de réception, #55) : jusqu'à 30 Mo sur un réseau mobile. L'envoi ne
 * se fait pas sous le verrou de synchro ; il reste borné pour qu'un envoi enlisé finisse par une erreur claire.
 */
export const UPLOAD_TIMEOUT_MS = 300_000

/** Envoi d'un objet Storage (POST/PUT sur /storage/v1/object/…). */
export function isUpload(input: RequestInfo | URL, init: RequestInit = {}): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = (init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
  return (method === 'POST' || method === 'PUT') && new URL(url, 'http://local').pathname.includes('/storage/v1/object/')
}

/**
 * `fetch` dont chaque requête est annulée (TimeoutError) si elle n'a pas répondu après `ms` (`uploadMs` pour un envoi
 * de fichier vers Storage).
 */
export function withTimeout(fetchImpl: typeof fetch, ms = REQUEST_TIMEOUT_MS, uploadMs = UPLOAD_TIMEOUT_MS): typeof fetch {
  return (input, init = {}) => {
    const ctrl = new AbortController()
    const delay = isUpload(input, init) ? uploadMs : ms
    const timer = setTimeout(() => ctrl.abort(new DOMException('Délai de la requête dépassé', 'TimeoutError')), delay)
    const outer = init.signal
    if (outer?.aborted) ctrl.abort(outer.reason)
    else outer?.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true })
    return fetchImpl(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer))
  }
}
