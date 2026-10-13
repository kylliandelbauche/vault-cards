import { useSyncExternalStore } from 'react'

/**
 * Konsta active son thème sombre via la classe `.dark` : on suit `prefers-color-scheme` de l'appareil,
 * et on rebascule en direct quand il change (réglage manuel, mode automatique au coucher du soleil…).
 * Retourne la fonction qui arrête l'écoute.
 */
export function followColorScheme(root: HTMLElement, darkQuery: MediaQueryList): () => void {
  const sync = () => root.classList.toggle('dark', darkQuery.matches)
  sync()
  darkQuery.addEventListener('change', sync)
  return () => darkQuery.removeEventListener('change', sync)
}

/** Valeur courante d'une media query, mise à jour en direct. `false` si matchMedia n'existe pas (jsdom). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    onChange => {
      if (typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}

/** Couleurs de `Page` Konsta : fond transparent pour laisser voir le fond décoratif (`.app-backdrop`). */
export const TRANSPARENT_PAGE = { bgIos: 'bg-transparent' }
