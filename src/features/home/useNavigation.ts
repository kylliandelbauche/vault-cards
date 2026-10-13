import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionScope } from '../review/useReviewSession'

/** Écran affiché : l'accueil, ou une session de révision (toutes les cartes ou un tag). */
export type Screen = { name: 'home' } | { name: 'review'; scope: SessionScope }

const HOME: Screen = { name: 'home' }
/** Marque posée dans `history.state` sur l'entrée « révision ». */
const REVIEW_ENTRY = 'vaultCardsReview'

const onReviewEntry = () => (window.history.state as Record<string, unknown> | null)?.[REVIEW_ENTRY] === true
const pushReviewEntry = () => window.history.pushState({ [REVIEW_ENTRY]: true }, '')

/**
 * Navigation sans routeur : un état local, et une entrée d'historique (`pushState`) par session de révision
 * pour que le geste / bouton « précédent » du navigateur revienne à l'accueil. L'URL ne change pas.
 * L'affichage ne dépend jamais du `popstate` provoqué par nos propres retours (`history.back()` est asynchrone).
 */
export function useNavigation() {
  const [screen, setScreen] = useState<Screen>(HOME)
  // Un `history.back()` lancé par goHome() dont le popstate n'est pas encore arrivé.
  const ownBack = useRef(false)
  // Session rouverte pendant ce retour : son entrée sera poussée une fois le retour terminé.
  const pushAfterBack = useRef(false)

  useEffect(() => {
    // Rechargement sur une entrée « révision » : l'app repart de l'accueil, on neutralise l'entrée.
    if (onReviewEntry()) window.history.replaceState(null, '')
    const onPop = () => {
      if (ownBack.current) {
        // Fin de notre propre retour : l'écran est déjà à jour ; on n'y touche pas.
        ownBack.current = false
        if (pushAfterBack.current) { pushAfterBack.current = false; pushReviewEntry() }
        return
      }
      // « Suivant » vers une ancienne entrée « révision » : on reste à l'accueil (la session est terminée).
      if (onReviewEntry()) window.history.replaceState(null, '')
      setScreen(HOME)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /** Ouvre une session : chaque appel crée un nouvel objet `scope`, donc une nouvelle session. */
  const openReview = useCallback((scope: SessionScope) => {
    if (ownBack.current) pushAfterBack.current = true // l'entrée courante va être dépilée : pousser après
    else if (onReviewEntry()) window.history.replaceState({ [REVIEW_ENTRY]: true }, '')
    else pushReviewEntry()
    setScreen({ name: 'review', scope: { ...scope } })
  }, [])

  /**
   * Retour à l'accueil : on dépile l'entrée « révision » (comme le bouton précédent) pour que l'historique
   * reste propre, et on affiche l'accueil tout de suite sans attendre `popstate`.
   */
  const goHome = useCallback(() => {
    if (ownBack.current) pushAfterBack.current = false // session rouverte puis quittée avant la fin du retour
    else if (onReviewEntry()) { ownBack.current = true; window.history.back() }
    setScreen(HOME)
  }, [])

  return { screen, openReview, goHome }
}
