import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import type { VaultDB } from '../../lib/db'
import { homeStats, type HomeStats } from '../../lib/home'
import type { Card, Review } from '../../lib/types'

export type HomeData = { status: 'loading' } | { status: 'error' } | { status: 'ready'; stats: HomeStats }

/**
 * Compteurs de l'accueil, recalculés en direct (liveQuery Dexie) : après une synchro qui ramène des cartes
 * ou des notes, après une session (notes ajoutées au cache), et au retour au premier plan (des cartes
 * deviennent dues avec le temps). Abonné seulement pendant que l'accueil est affiché.
 */
export function useHomeData(db: VaultDB, now: () => Date): HomeData {
  const [data, setData] = useState<HomeData>({ status: 'loading' })
  const raw = useRef<{ cards: Card[]; reviews: Review[] } | null>(null)
  const clock = useRef(now)
  useEffect(() => { clock.current = now })

  useEffect(() => {
    const compute = () => {
      if (raw.current) setData({ status: 'ready', stats: homeStats(raw.current.cards, raw.current.reviews, clock.current()) })
    }
    const sub = liveQuery(() => Promise.all([db.cards.toArray(), db.reviews.toArray()])).subscribe({
      next: ([cards, reviews]) => { raw.current = { cards, reviews }; compute() },
      error: () => setData({ status: 'error' }),
    })
    const onResume = () => { if (document.visibilityState === 'visible') compute() }
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      sub.unsubscribe()
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [db])

  return data
}
