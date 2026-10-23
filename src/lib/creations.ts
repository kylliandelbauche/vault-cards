import { documentLabel } from './myCards'
import type { Card } from './types'

/**
 * « Tes créations » du hub « Nouvelles cartes » (#86), calculé depuis le cache local (aucune donnée nouvelle, hors
 * ligne). Sont créées par Kyllian les cartes `manual` et `inbox` ; les cartes `vault` viennent de /flashcards.
 */

/** Dernier document de la boîte de réception qui a produit des cartes. */
export interface LastGeneration {
  inboxId: string
  /** Nom du document (`source_title`), ou « Document importé » s'il manque. */
  title: string
  /** Création de sa carte la plus récente (ISO) : « il y a … ». */
  at: string
  /** Cartes du document, brouillons compris (supprimées exclues). */
  count: number
  /** Brouillons encore à valider. */
  drafts: number
}

export interface Creations {
  /** Cartes créées : actives, non supprimées, `manual` ou `inbox` (brouillons exclus). */
  total: number
  /** Parmi elles, celles créées pendant le mois civil local de `now`. */
  thisMonth: number
  last: LastGeneration | null
}

const stamp = (c: Card) => c.created_at ?? c.updated_at

export function computeCreations(all: readonly Card[], now: Date): Creations {
  let total = 0
  let thisMonth = 0
  const groups = new Map<string, LastGeneration>()
  for (const c of all) {
    if (c.deleted_at !== null || c.source === 'vault') continue
    const draft = c.status === 'draft'
    if (!draft) {
      total++
      const d = new Date(stamp(c))
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) thisMonth++
    }
    if (c.source !== 'inbox' || !c.inbox_id) continue
    const g = groups.get(c.inbox_id)
    const at = stamp(c)
    if (!g) {
      groups.set(c.inbox_id, { inboxId: c.inbox_id, title: documentLabel(c) as string, at, count: 1, drafts: draft ? 1 : 0 })
      continue
    }
    g.count++
    if (draft) g.drafts++
    if (at > g.at) { g.at = at; g.title = documentLabel(c) as string }
  }
  let last: LastGeneration | null = null
  for (const g of groups.values()) {
    if (!last || g.at > last.at || (g.at === last.at && g.inboxId < last.inboxId)) last = g
  }
  return { total, thisMonth, last }
}
