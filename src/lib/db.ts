import Dexie, { type Table } from 'dexie'
import type { Card, Review } from './types'

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
  }
}

export const db = new VaultDB()
