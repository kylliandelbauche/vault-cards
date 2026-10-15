import { useEffect, useMemo, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import type { ManualCardInput } from '../../lib/cards'
import type { VaultDB } from '../../lib/db'
import { acceptAll, acceptDraft, listDrafts, rejectDraft, updateDraft } from '../../lib/drafts'
import type { Card } from '../../lib/types'

export interface DraftsOptions {
  /** Appelé après chaque écriture locale réussie (à brancher sur `syncNow` pour envoyer sans attendre). */
  onWrite?(): void
  now?(): Date
}

export interface Drafts {
  /** Brouillons vivants (de l'élément, ou tous), dans l'ordre de création ; null avant le premier chargement ou en erreur. */
  drafts: Card[] | null
  error: Error | null
  /** Retouche sans accepter. Rejette avec CardValidationError si invalide. */
  update(id: string, patch: Partial<ManualCardInput>): Promise<Card>
  /** Accepte (éventuellement retouché) : la carte entre dans les sessions. */
  accept(id: string, patch?: Partial<ManualCardInput>): Promise<Card>
  /** Rejette (suppression douce). */
  reject(id: string): Promise<void>
  /** « Tout accepter » (les brouillons listés par ce hook) ; renvoie leur nombre. */
  acceptAll(): Promise<number>
}

/**
 * Mécanique de l'écran de relecture (#55), sans interface : l'écran dessiné par Kyllian s'y branche.
 * Lecture en direct du cache local ; écritures locales immédiates, envoyées par la synchro (file « cartes »).
 */
export function useDrafts(db: VaultDB, inboxId?: string, options: DraftsOptions = {}): Drafts {
  const [drafts, setDrafts] = useState<Card[] | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const opts = useRef(options)
  useEffect(() => { opts.current = options })

  useEffect(() => {
    const sub = liveQuery(() => listDrafts(db, inboxId)).subscribe({
      next: rows => { setError(null); setDrafts(rows) },
      error: (e: unknown) => { setDrafts(null); setError(e instanceof Error ? e : new Error(String(e))) },
    })
    return () => sub.unsubscribe()
  }, [db, inboxId])

  return useMemo(() => {
    const now = () => opts.current.now?.() ?? new Date()
    const written = <T>(value: T) => { opts.current.onWrite?.(); return value }
    return {
      drafts,
      error,
      update: async (id, patch) => written(await updateDraft(db, id, patch, { now })),
      accept: async (id, patch) => written(await acceptDraft(db, id, patch, { now })),
      reject: async id => written(await rejectDraft(db, id, { now })),
      acceptAll: async () => written(await acceptAll(db, inboxId, { now })),
    }
  }, [db, inboxId, drafts, error])
}
