import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addFile, addText, listInbox, type InboxDeps, type InboxItem } from '../../lib/inbox'

export interface InboxState {
  /** Derniers éléments (statuts), le plus récent d'abord ; null avant le premier chargement ou si la lecture a échoué. */
  items: InboxItem[] | null
  /** Dernière lecture en échec (hors ligne, session…) ; aucun log. */
  error: Error | null
  /** Relit les statuts (réseau). */
  refresh(): Promise<void>
  /** Rejettent avec InboxError (`code`) : rien n'est créé. Relisent la liste après un dépôt réussi. */
  addText(text: string): Promise<InboxItem>
  addFile(file: File): Promise<InboxItem>
}

/**
 * Mécanique de la boîte de réception (#55), sans interface. Les statuts ne sont pas mis en cache (ils changent côté
 * Mac) : lecture au montage, puis `refresh` à la demande (ex. retour au premier plan). Les brouillons produits arrivent
 * par la synchro des cartes (useDrafts).
 */
export function useInbox(deps: InboxDeps): InboxState {
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const ref = useRef(deps)
  useEffect(() => { ref.current = deps })

  const refresh = useCallback(async () => {
    try {
      setItems(await listInbox(ref.current.client))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return useMemo(() => ({
    items,
    error,
    refresh,
    addText: async text => { const item = await addText(ref.current, text); void refresh(); return item },
    addFile: async file => { const item = await addFile(ref.current, file); void refresh(); return item },
  }), [items, error, refresh])
}
