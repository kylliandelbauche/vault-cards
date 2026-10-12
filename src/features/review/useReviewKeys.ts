import { useEffect } from 'react'
import type { Rating } from '../../lib/types'
import type { ReviewSession } from './useReviewSession'

const RATING_KEYS: Record<string, Rating> = { '1': 1, '2': 2, '3': 3 }

/** Clavier (ordinateur) : Espace / Entrée = révéler ; 1 / 2 / 3 = noter. */
export function useReviewKeys({ status, revealed, reveal, rate }: Pick<ReviewSession, 'status' | 'revealed' | 'reveal' | 'rate'>) {
  useEffect(() => {
    if (status !== 'reviewing') return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
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
