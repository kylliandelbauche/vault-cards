/** Verrou partagé par tous les onglets et fenêtres de l'app (même origine). */
export const SYNC_LOCK = 'vault-cards-sync'

/** Sync pas lancé : un autre onglet synchronise déjà (il pousse et tire pour tout le monde, le cache est partagé). */
export const SKIPPED = Symbol('sync-skipped')

type Locks = Pick<LockManager, 'request'>

/**
 * Lance `fn` sous le verrou Web Locks `SYNC_LOCK` s'il est libre, sinon renvoie SKIPPED sans attendre.
 * Sans Web Locks (vieux navigateur, ou `locks` null), lance `fn` directement : la garde par onglet de useAutoSync reste.
 */
export async function withSyncLock<T>(
  fn: () => Promise<T>,
  locks: Locks | null | undefined = typeof navigator === 'undefined' ? undefined : navigator.locks,
): Promise<T | typeof SKIPPED> {
  if (!locks?.request) return fn()
  return locks.request(SYNC_LOCK, { ifAvailable: true }, lock => (lock ? fn() : SKIPPED))
}
