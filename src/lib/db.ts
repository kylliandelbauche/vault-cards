import Dexie, { type Table } from 'dexie'
import type { Card, Review } from './types'

/** Upgrade v2 : les cartes mises en cache avant les tags reçoivent `tags: []`. */
export function addMissingTags(card: { tags?: unknown }): void {
  if (!Array.isArray(card.tags)) card.tags = []
}

/** Cache local (IndexedDB) : cartes, reviews (`synced: 0` = à pousser) et curseurs de synchro. */
export class VaultDB extends Dexie {
  cards!: Table<Card, string>
  reviews!: Table<Review, string>
  meta!: Table<{ key: string; value: string }, string>
  constructor(name = 'vault-cards') {
    super(name)
    this.version(1).stores({
      cards: 'id, updated_at, source_path',
      reviews: 'id, card_id, synced, reviewed_at',
      meta: 'key',
    })
    // v2 : tags (#26). Index multiEntry `*tags` pour le futur filtre par tag.
    this.version(2)
      .stores({ cards: 'id, updated_at, source_path, *tags' })
      .upgrade(tx => tx.table('cards').toCollection().modify(addMissingTags))
  }
}

export const db = new VaultDB()
