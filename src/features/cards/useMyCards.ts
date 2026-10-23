import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import type { VaultDB } from '../../lib/db'
import { indexCards, type MyCardsIndex } from '../../lib/myCards'
import type { Card } from '../../lib/types'

export type MyCardsData =
  | { status: 'loading' }
  | { status: 'error' }
  | ({ status: 'ready' } & MyCardsIndex)

/**
 * Cartes de « Mes cartes » (#80), en direct du cache local : une modification ou une suppression (ici, en révision ou
 * par la synchro) met la liste à jour toute seule. L'index n'est recalculé qu'à une nouvelle lecture du cache.
 */
export function useMyCards(db: VaultDB): MyCardsData {
  const [rows, setRows] = useState<Card[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const sub = liveQuery(() => db.cards.toArray()).subscribe({
      next: r => { setFailed(false); setRows(r) },
      error: () => setFailed(true),
    })
    return () => sub.unsubscribe()
  }, [db])
  return useMemo<MyCardsData>(() => {
    if (failed) return { status: 'error' }
    if (rows === null) return { status: 'loading' }
    return { status: 'ready', ...indexCards(rows) }
  }, [rows, failed])
}
