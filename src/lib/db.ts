import Dexie, { type Table } from 'dexie'
import type { Card, Review } from './types'

/** Upgrade v2 : les cartes mises en cache avant les tags reçoivent `tags: []`. */
export function addMissingTags(card: { tags?: unknown }): void {
  if (!Array.isArray(card.tags)) card.tags = []
}

/** Upgrade v3 : les cartes mises en cache avant #35 reçoivent `source_title: null` (l'app se replie sur le nom de fichier). */
export function addMissingSourceTitle(card: { source_title?: unknown }): void {
  if (typeof card.source_title !== 'string') card.source_title = null
}

/** Upgrade v4 : les cartes mises en cache avant #54 viennent toutes du vault. */
export function addMissingSource(card: { source?: unknown }): void {
  if (card.source !== 'vault' && card.source !== 'manual') card.source = 'vault'
}

/** Cache local (IndexedDB) : cartes et reviews (`synced: 0` = à pousser) et curseurs de synchro. */
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
    // v3 : source_title (#35), colonne simple non indexée -> mêmes stores, seule la mise à niveau des données compte.
    // RÈGLE : toute nouvelle colonne de `cards` remplie côté serveur → supprimer cursor:cards dans l'upgrade.
    // Sans cela, une app qui s'est synchronisée après le backfill serveur mais avant la mise à niveau a un curseur
    // déjà trop avancé : le pull incrémental (après le curseur) ne rapporte jamais la valeur (cf. #38, tags #26).
    // Sans curseur = pull complet une fois, idempotent (bulkPut écrase les lignes) ; reviews et cursor:reviews intacts.
    this.version(3)
      .stores({ cards: 'id, updated_at, source_path, *tags' })
      .upgrade(async tx => {
        await tx.table('cards').toCollection().modify(addMissingSourceTitle)
        await tx.table('meta').delete('cursor:cards')
      })
    // v4 : cartes manuelles (#54). Colonnes `source` et `created_at` désormais tirées du serveur → règle ci-dessus (cursor:cards supprimé).
    // Index `synced` : file d'envoi des cartes manuelles (absent sur les cartes tirées du serveur, donc non indexées).
    this.version(4)
      .stores({ cards: 'id, updated_at, source_path, *tags, synced' })
      .upgrade(async tx => {
        await tx.table('cards').toCollection().modify(addMissingSource)
        await tx.table('meta').delete('cursor:cards')
      })
  }
}

export const db = new VaultDB()
