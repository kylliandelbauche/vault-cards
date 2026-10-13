import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** `matchMedia` absent (tests, très vieux navigateurs) : on considère que les animations sont permises. */
const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null)

function subscribe(onChange: () => void) {
  const q = query()
  q?.addEventListener('change', onChange)
  return () => q?.removeEventListener('change', onChange)
}

/**
 * « Réduire les animations » de l'appareil, suivi en direct. Sert à couper le reflet Konsta
 * (lumière qui suit le doigt + léger grossissement à l'appui) des boutons en verre.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false)
}
