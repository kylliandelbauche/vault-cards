import { useEffect, useMemo, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { createManualCard, deleteManualCard, updateManualCard, type ManualCardInput } from '../../lib/cards'
import type { VaultDB } from '../../lib/db'
import type { Card } from '../../lib/types'

export interface ManualCardsOptions {
  /** Appelé après chaque écriture locale réussie (à brancher sur `syncNow` pour envoyer sans attendre). */
  onWrite?(): void
  now?(): Date
}

export interface ManualCards {
  /** Cartes manuelles vivantes, la plus récemment créée ou modifiée d'abord ; null avant le premier chargement. */
  cards: Card[] | null
  /** Rejette avec CardValidationError (champ `field`) si la saisie est invalide : rien n'est écrit. */
  create(input: ManualCardInput): Promise<Card>
  update(id: string, patch: Partial<ManualCardInput>): Promise<Card>
  /** Suppression douce. */
  remove(id: string): Promise<void>
}

/**
 * Mécanique des cartes créées à la main (#54), sans interface : l'écran (maquette Paper) s'y branche.
 * Écritures locales immédiates (hors ligne compris), envoyées par la synchro (file « cartes », avant les reviews).
 */
export function useManualCards(db: VaultDB, options: ManualCardsOptions = {}): ManualCards {
  const [cards, setCards] = useState<Card[] | null>(null)
  const opts = useRef(options)
  useEffect(() => { opts.current = options })

  useEffect(() => {
    const sub = liveQuery(() => db.cards.filter(c => c.source === 'manual' && c.deleted_at === null).toArray()).subscribe({
      next: rows => setCards(rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))),
      error: () => setCards([]),
    })
    return () => sub.unsubscribe()
  }, [db])

  return useMemo(() => {
    const now = () => opts.current.now?.() ?? new Date()
    const written = <T>(value: T) => { opts.current.onWrite?.(); return value }
    return {
      cards,
      create: async input => written(await createManualCard(db, input, { now })),
      update: async (id, patch) => written(await updateManualCard(db, id, patch, { now })),
      remove: async id => written(await deleteManualCard(db, id, { now })),
    }
  }, [db, cards])
}
