import { useCallback, useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import type { VaultDB } from '../../lib/db'
import { pendingCount, SyncError } from '../../lib/sync'
import { SKIPPED, withSyncLock } from '../../lib/syncLock'
import type { SyncIndicator } from '../../components/TopBar'
import type { ReviewSession } from './useReviewSession'

export type AutoSyncSession = Pick<ReviewSession, 'status' | 'stats' | 'restart'>
type SyncResult = { pulledCards: number; pulledReviews: number }
export type { SyncIndicator }
export interface SyncState { syncing: boolean; lastSync: 'ok' | 'failed' | null }
export interface AutoSync extends SyncState {
  /** Lance un sync tout de suite (ex. retour à l'accueil au milieu d'une session : pousse les notes déjà données). */
  syncNow(): void
}

/** Retour au premier plan (onglet, fenêtre, PWA iOS) : au plus un sync réussi par intervalle. */
export const RESUME_SYNC_MIN_INTERVAL_MS = 30_000

/** « Synchronisé » seulement si rien n'attend d'être poussé et que le dernier sync a réussi. */
export const syncIndicator = (pending: number, { syncing, lastSync }: SyncState): SyncIndicator =>
  syncing ? 'syncing' : pending === 0 && lastSync === 'ok' ? 'synced' : 'unsynced'

/**
 * La session peut être rechargée sans rien faire perdre : aucune carte, ou « terminée »
 * sans une seule note (rien n'était dû dans le cache à l'ouverture). Après une vraie session,
 * on garde le bilan à l'écran ; « Réviser à nouveau » relira le cache à jour.
 */
const reloadable = ({ status, stats }: AutoSyncSession) =>
  status === 'empty' || (status === 'done' && stats.again + stats.hard + stats.good === 0)

/**
 * Lance `run` (le sync) au montage, au retour du réseau, quand la session se termine, et au
 * retour au premier plan (`visibilitychange` → visible, `focus`) si le dernier sync réussi a commencé
 * il y a au moins RESUME_SYNC_MIN_INTERVAL_MS (un sync en échec ne compte pas : on réessaie au prochain retour). Jamais deux syncs en parallèle : dans l'onglet (`running`), et entre
 * onglets par le verrou Web Locks (withSyncLock) ; un sync sauté parce qu'un autre onglet synchronise ne change pas l'état.
 * Les erreurs sont avalées : hors ligne ou jeton expiré, on réessaiera au prochain déclencheur.
 * Si le sync a ramené des données alors que la session est rechargeable, appelle `restart()`.
 * Session `idle` (écran d'accueil) : rien à recharger, l'accueil suit lui-même le cache local.
 */
export function useAutoSync(session: AutoSyncSession, run: () => Promise<SyncResult>): AutoSync {
  const [state, setState] = useState<SyncState>({ syncing: false, lastSync: null })
  // Dernières valeurs, lues à la fin d'un sync sans en faire des dépendances.
  const io = useRef({ session, run })
  useEffect(() => { io.current = { session, run } })
  const running = useRef(false)
  const again = useRef(false)
  // Données reçues pendant le chargement initial : à recharger s'il se termine vide.
  const stale = useRef(false)
  // Début du dernier sync réussi : un sync en échec, partiel ou sauté ne compte pas (on réessaie au prochain retour).
  const lastOk = useRef(-Infinity)
  const currentStart = useRef(-Infinity)

  // Données tirées : recharge une session rechargeable, ou le note si elle est encore en chargement.
  const received = useCallback(({ pulledCards, pulledReviews }: SyncResult) => {
    if (pulledCards + pulledReviews === 0) return
    const s = io.current.session
    if (reloadable(s)) s.restart()
    else if (s.status === 'loading') stale.current = true
  }, [])

  const trigger = useCallback(async () => {
    if (running.current) { again.current = true; return }
    running.current = true
    setState(s => ({ ...s, syncing: true }))
    try {
      do {
        again.current = false
        const started = (currentStart.current = Date.now())
        try {
          const res = await withSyncLock(() => io.current.run())
          if (res === SKIPPED) continue // un autre onglet synchronise : il remplit le cache partagé pour nous
          lastOk.current = started
          setState(s => ({ ...s, lastSync: 'ok' }))
          received(res)
        } catch (e) {
          // Silencieux (aucun log) : l'indicateur passe à « Non synchronisé ».
          setState(s => ({ ...s, lastSync: 'failed' }))
          // Push en échec mais pull réussi (ou l'inverse) : ce qui a été tiré compte quand même.
          if (e instanceof SyncError) received(e.result)
        }
      } while (again.current)
    } finally {
      running.current = false
      setState(s => ({ ...s, syncing: false }))
    }
  }, [received])

  useEffect(() => {
    void trigger()
    const onOnline = () => { void trigger() }
    const onResume = () => {
      if (document.visibilityState !== 'visible') return
      const t = Date.now()
      // Un sync lancé il y a moins de l'intervalle et encore en cours suffit (focus + visibilitychange arrivent ensemble).
      if (running.current && t - currentStart.current < RESUME_SYNC_MIN_INTERVAL_MS) return
      if (t - lastOk.current < RESUME_SYNC_MIN_INTERVAL_MS) return
      void trigger()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
    }
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

  const syncNow = useCallback(() => { void trigger() }, [trigger])
  return { ...state, syncNow }
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
