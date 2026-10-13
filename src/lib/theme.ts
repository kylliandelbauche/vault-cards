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

/** Couleurs de `Page` Konsta : fond transparent pour laisser voir le fond décoratif (`.app-backdrop`). */
export const TRANSPARENT_PAGE = { bgIos: 'bg-transparent' }
