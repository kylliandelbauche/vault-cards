import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import type { VaultDB } from '../../lib/db'
import { homeStats, type HomeStats } from '../../lib/home'
import type { Card, Review, Tag } from '../../lib/types'

export type HomeData = { status: 'loading' } | { status: 'error' } | { status: 'ready'; stats: HomeStats }

/** Délai jusqu'au prochain minuit local (+1 s de marge), pour recalculer le quota du jour. */
export function msUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
  return Math.max(1000, next.getTime() - now.getTime())
}

/**
 * Compteurs de l'accueil, recalculés en direct (liveQuery Dexie) tant que `active` : après une synchro qui
 * ramène des cartes ou des notes, après une session (notes ajoutées au cache), au retour au premier plan
 * (des cartes deviennent dues avec le temps) et au passage de minuit (quota du jour neuf).
 * Inactif (révision affichée) : aucun abonnement ; les derniers compteurs sont gardés et réaffichés aussitôt
 * au retour, le temps du recalcul (pas de spinner).
 */
export function useHomeData(db: VaultDB, now: () => Date, active: boolean): HomeData {
  const [data, setData] = useState<HomeData>({ status: 'loading' })
  const raw = useRef<{ cards: Card[]; reviews: Review[]; tags: Tag[] } | null>(null)
  const clock = useRef(now)
  useEffect(() => { clock.current = now })

  useEffect(() => {
    if (!active) return
    let midnight: ReturnType<typeof setTimeout> | undefined
    const compute = () => {
      if (raw.current) setData({ status: 'ready', stats: homeStats(raw.current.cards, raw.current.reviews, clock.current(), undefined, raw.current.tags) })
    }
    // Une seule minuterie, jusqu'au prochain minuit local, réarmée à chaque passage (aucune boucle).
    const armMidnight = () => {
      clearTimeout(midnight)
      midnight = setTimeout(() => { compute(); armMidnight() }, msUntilNextLocalDay(clock.current()))
    }
    const sub = liveQuery(() => Promise.all([db.cards.toArray(), db.reviews.toArray(), db.tags.toArray()])).subscribe({
      next: ([cards, reviews, tags]) => { raw.current = { cards, reviews, tags }; compute() },
      error: () => setData({ status: 'error' }),
    })
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      compute()
      armMidnight() // une minuterie en arrière-plan peut avoir été retardée ou suspendue
    }
    armMidnight()
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      sub.unsubscribe()
      clearTimeout(midnight)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [db, active])

  return data
}
