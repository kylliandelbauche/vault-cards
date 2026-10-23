import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { computeCreations, type Creations } from '../../lib/creations'
import type { VaultDB } from '../../lib/db'
import type { Card } from '../../lib/types'

/**
 * « Tes créations » (#86), en direct du cache local : une carte créée, acceptée ou supprimée (ici ou par la synchro)
 * met les chiffres à jour. Seules les cartes `manual` et `inbox` sont gardées en mémoire. `null` avant la première
 * lecture ou si le cache est illisible (le hub n'affiche alors pas le bloc).
 */
export function useCreations(db: VaultDB, now: () => Date): Creations | null {
  const [rows, setRows] = useState<Card[] | null>(null)
  useEffect(() => {
    const sub = liveQuery(() => db.cards.filter(c => c.source !== 'vault').toArray()).subscribe({
      next: setRows,
      error: () => setRows(null),
    })
    return () => sub.unsubscribe()
  }, [db])
  return useMemo(() => (rows ? computeCreations(rows, now()) : null), [rows, now])
}
