import { useEffect } from 'react'
import type { Rating } from '../../lib/types'
import type { ReviewSession } from './useReviewSession'

const RATING_KEYS: Record<string, Rating> = { '1': 1, '2': 2, '3': 3 }

/**
 * Une fenêtre de l'app est ouverte (Profil, Recherche, menu ⋯ de la carte, confirmation…) : les touches sont pour elle,
 * jamais pour la carte derrière. Testé sur la cible et sur le document (Safari/iOS : le focus peut rester sur <body>).
 */
const DIALOG = '[role="dialog"], [role="alertdialog"], [role="menu"]'
const dialogOpen = (target: EventTarget | null) =>
  (target instanceof Element && target.closest(DIALOG) !== null) || document.querySelector(DIALOG) !== null

/**
 * Clavier (ordinateur) : Espace / Entrée = révéler ; 1 / 2 / 3 = noter. Rien quand une fenêtre est ouverte, ni quand
 * `paused` (« Modifier la carte » affichée à la place de la révision, #73).
 */
export function useReviewKeys({ status, revealed, reveal, rate }: Pick<ReviewSession, 'status' | 'revealed' | 'reveal' | 'rate'>, paused = false) {
  useEffect(() => {
    if (status !== 'reviewing' || paused) return
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
  }, [status, revealed, reveal, rate, paused])
}
