import { createContext, useContext, useEffect, useRef } from 'react'

/** Enregistre le garde de l'écran affiché ; renvoie de quoi le retirer (sans effacer un garde posé depuis). */
export type RegisterLeaveGuard = (guard: () => void) => () => void

/** Fourni par la navigation ; sans fournisseur (écran isolé, tests), aucun garde. */
export const LeaveGuardContext = createContext<RegisterLeaveGuard>(() => () => {})

/**
 * Écran avec une saisie non enregistrée (#88) : tant que `dirty`, le retour de l'utilisateur (geste iOS, bouton
 * « précédent ») ne quitte pas l'écran ; la navigation garde l'historique en place et appelle `onRequestLeave`, qui
 * ouvre la même confirmation que le ✕. Sans modification, le retour reste immédiat.
 */
export function useLeaveGuard(dirty: boolean, onRequestLeave: () => void) {
  const register = useContext(LeaveGuardContext)
  const latest = useRef(onRequestLeave)
  useEffect(() => { latest.current = onRequestLeave })
  useEffect(() => (dirty ? register(() => latest.current()) : undefined), [dirty, register])
}
