import { useEffect } from 'react'
import type { Rating } from '../../lib/types'
import type { ReviewSession } from './useReviewSession'

const RATING_KEYS: Record<string, Rating> = { '1': 1, '2': 2, '3': 3 }

/**
 * Une fenêtre de l'app est ouverte (Profil, Recherche, abandon des modifications…) : les touches sont pour elle, jamais
 * pour la carte derrière. Testé sur la cible et sur le document (Safari/iOS : le focus peut rester sur <body>).
 */
const DIALOG = '[role="dialog"], [role="alertdialog"]'
const dialogOpen = (target: EventTarget | null) =>
  (target instanceof Element && target.closest(DIALOG) !== null) || document.querySelector(DIALOG) !== null

/** Clavier (ordinateur) : Espace / Entrée = révéler ; 1 / 2 / 3 = noter. Rien quand une fenêtre est ouverte. */
export function useReviewKeys({ status, revealed, reveal, rate }: Pick<ReviewSession, 'status' | 'revealed' | 'reveal' | 'rate'>) {
  useEffect(() => {
    if (status !== 'reviewing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || dialogOpen(e.target)) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        reveal()
      } else if (revealed && e.key in RATING_KEYS) {
        e.preventDefault()
        rate(RATING_KEYS[e.key])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, revealed, reveal, rate])
}
