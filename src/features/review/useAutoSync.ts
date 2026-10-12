import { useCallback, useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import type { VaultDB } from '../../lib/db'
import { pendingCount } from '../../lib/sync'
import type { ReviewSession } from './useReviewSession'

export type AutoSyncSession = Pick<ReviewSession, 'status' | 'stats' | 'restart'>
type SyncResult = { pulledCards: number; pulledReviews: number }

/**
 * La session peut être rechargée sans rien faire perdre : aucune carte, ou « terminée »
 * sans une seule note (rien n'était dû dans le cache à l'ouverture). Après une vraie session,
 * on garde le bilan à l'écran ; « Réviser à nouveau » relira le cache à jour.
 */
const reloadable = ({ status, stats }: AutoSyncSession) =>
  status === 'empty' || (status === 'done' && stats.again + stats.hard + stats.good === 0)

/**
 * Lance `run` (le sync) au montage, au retour du réseau et quand la session se termine.
 * Les erreurs sont avalées : hors ligne ou jeton expiré, on réessaiera au prochain déclencheur.
 * Si le sync a ramené des données alors que la session est rechargeable, appelle `restart()`.
 */
export function useAutoSync(session: AutoSyncSession, run: () => Promise<SyncResult>) {
  // Dernières valeurs, lues à la fin d'un sync sans en faire des dépendances.
  const io = useRef({ session, run })
  useEffect(() => { io.current = { session, run } })
  const running = useRef(false)
  const again = useRef(false)
  // Données reçues pendant le chargement initial : à recharger s'il se termine vide.
  const stale = useRef(false)

  const trigger = useCallback(async () => {
    if (running.current) { again.current = true; return }
    running.current = true
    try {
      do {
        again.current = false
        try {
          const { pulledCards, pulledReviews } = await io.current.run()
          if (pulledCards + pulledReviews === 0) continue
          const s = io.current.session
          if (reloadable(s)) s.restart()
          else if (s.status === 'loading') stale.current = true
        } catch {
          // Silencieux : l'indicateur « non synchronisé » reflète les reviews en attente.
        }
      } while (again.current)
    } finally {
      running.current = false
    }
  }, [])

  useEffect(() => {
    void trigger()
    const onOnline = () => { void trigger() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [trigger])

  const { status } = session
  const canReload = reloadable(session)
  useEffect(() => {
    if (status === 'loading') return
    if (stale.current && canReload) io.current.session.restart()
    stale.current = false
  }, [status, canReload])

  // Fin d'une vraie session : pousse ses notes (un « done » sans aucune note n'a rien à pousser).
  useEffect(() => {
    if (status === 'done' && !canReload) void trigger()
  }, [status, canReload, trigger])
}

/** Nombre de reviews locales pas encore poussées, mis à jour en direct (liveQuery Dexie). */
export function usePendingCount(db: VaultDB) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const sub = liveQuery(() => pendingCount(db)).subscribe({ next: setCount, error: () => {} })
    return () => sub.unsubscribe()
  }, [db])
  return count
}
