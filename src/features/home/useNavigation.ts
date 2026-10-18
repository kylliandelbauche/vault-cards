import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionScope } from '../review/useReviewSession'

/** Écran d'une source déposée dans la boîte de réception (#81) : ses brouillons (ou tous si `inboxId` absent). */
export interface DraftsTarget {
  inboxId?: string
  /** Nom affiché de la source (« Depuis « … » »), connu dès l'envoi. */
  source?: string
}

/**
 * Écran affiché : l'accueil, « Mes tags », une session de révision, ou la boîte de réception (#81) : saisie d'un
 * texte, brouillons d'une source, modification d'un brouillon.
 */
export type Screen =
  | { name: 'home' }
  | { name: 'tags' }
  | { name: 'review'; scope: SessionScope }
  | { name: 'source-text' }
  | ({ name: 'drafts' } & DraftsTarget)
  | ({ name: 'edit'; cardId: string } & DraftsTarget)

const HOME: Screen = { name: 'home' }
/** Profondeur de l'entrée d'historique dans la pile d'écrans (0 = accueil), posée dans `history.state`. */
const DEPTH = 'vaultCardsDepth'

const historyDepth = () => {
  const d = (window.history.state as Record<string, unknown> | null)?.[DEPTH]
  return typeof d === 'number' ? d : 0
}

/**
 * Navigation sans routeur : une pile d'écrans (accueil → Mes tags → révision) dans l'état React, et une entrée
 * d'historique par niveau (`pushState`, l'URL ne change pas), pour que le geste / bouton « précédent » du
 * navigateur remonte d'un écran. L'affichage suit toujours la pile tout de suite ; l'historique est ensuite
 * aligné sur elle (`reconcile`). Le `popstate` de nos propres retours (asynchrones) est reconnu et ignoré.
 */
export function useNavigation() {
  const [stack, setStack] = useState<Screen[]>([HOME])
  const live = useRef<Screen[]>([HOME])
  // Un retour d'historique lancé par nous, dont le popstate n'est pas encore arrivé.
  const ownTraversal = useRef(false)

  const commit = useCallback((next: Screen[]) => {
    live.current = next
    setStack(next)
  }, [])

  /** Aligne l'historique sur la pile : pousse les niveaux manquants, ou recule des niveaux en trop. */
  const reconcile = useCallback(() => {
    if (ownTraversal.current) return // on réalignera à l'arrivée du popstate
    const depth = historyDepth()
    const target = live.current.length - 1
    for (let d = depth + 1; d <= target; d++) window.history.pushState({ [DEPTH]: d }, '')
    if (target < depth) {
      ownTraversal.current = true
      window.history.go(target - depth)
    }
  }, [])

  useEffect(() => {
    // Rechargement sur une entrée profonde : l'app repart de l'accueil, on neutralise l'entrée.
    if (historyDepth() > 0) window.history.replaceState(null, '')
    const onPop = () => {
      if (ownTraversal.current) {
        ownTraversal.current = false
        reconcile()
        return
      }
      // « Précédent » / « suivant » du navigateur : on remonte la pile jusqu'à ce niveau. Un « suivant » vers
      // un niveau qui n'existe plus est ramené au niveau courant.
      const depth = historyDepth()
      if (depth < live.current.length - 1) commit(live.current.slice(0, depth + 1))
      else reconcile()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [commit, reconcile])

  const push = useCallback((screen: Screen) => {
    // Jamais deux sessions empilées : une révision remplace la révision courante.
    const base = live.current.at(-1)?.name === 'review' ? live.current.slice(0, -1) : live.current
    commit([...base, screen])
    reconcile()
  }, [commit, reconcile])

  /** Ouvre une session : chaque appel crée un nouvel objet `scope`, donc une nouvelle session. */
  const openReview = useCallback((scope: SessionScope) => push({ name: 'review', scope: { ...scope } }), [push])
  /** Ouvre la page « Mes tags ». */
  const openTags = useCallback(() => push({ name: 'tags' }), [push])

  /** Ouvre un écran de la boîte de réception (Source · Texte, Brouillons, Modifier). */
  const open = useCallback((next: Screen) => push(next), [push])
  /** Remplace l'écran courant (ex. Source · Texte → Brouillons après l'envoi) : « précédent » ramène avant lui. */
  const replace = useCallback((next: Screen) => {
    commit([...live.current.slice(0, -1), next])
  }, [commit])

  /** Écran précédent (chevron). */
  const back = useCallback(() => {
    if (live.current.length > 1) { commit(live.current.slice(0, -1)); reconcile() }
  }, [commit, reconcile])

  /** Retour direct à l'accueil (« Retour à l'accueil » de l'écran de fin). */
  const goHome = useCallback(() => {
    if (live.current.length > 1) { commit([HOME]); reconcile() }
  }, [commit, reconcile])

  const screen = stack[stack.length - 1]
  const previous = stack.length > 1 ? stack[stack.length - 2] : null
  return { screen, previous, openReview, openTags, open, replace, back, goHome }
}
