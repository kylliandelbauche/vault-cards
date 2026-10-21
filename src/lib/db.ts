import Dexie, { type Table } from 'dexie'
import { LEGACY_TAG_NAMES } from '../../shared/tags'
import type { Card, Review, Tag } from './types'

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
  if (card.source !== 'vault' && card.source !== 'manual' && card.source !== 'inbox') card.source = 'vault'
}

/**
 * Upgrade v6 (#79) : les anciens slugs de tags (#26) deviennent les noms des tags qui les remplacent, comme la
 * migration serveur. Indispensable pour une carte manuelle pas encore envoyée : elle partirait sinon avec « ia » et
 * créerait un tag « ia » à côté de « IA & agents ». Un nom inconnu (déjà libre) est gardé tel quel.
 */
export function renameLegacyTags(card: { tags?: unknown }): void {
  if (!Array.isArray(card.tags)) return
  card.tags = card.tags.map(t => (typeof t === 'string' && Object.hasOwn(LEGACY_TAG_NAMES, t) ? LEGACY_TAG_NAMES[t] : t))
}

/** Cache local (IndexedDB) : cartes et reviews (`synced: 0` = à pousser) et curseurs de synchro. */
export class VaultDB extends Dexie {
  cards!: Table<Card, string>
  reviews!: Table<Review, string>
  meta!: Table<{ key: string; value: string }, string>
  tags!: Table<Tag, string>
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
    // v5 : boîte de réception (#55). Colonnes `status` et `inbox_id` tirées du serveur → règle ci-dessus (cursor:cards
    // supprimé : le pull complet les rapporte). Les cartes déjà en cache ne sont pas réécrites : `status` absent = active.
    // Index `inbox_id` : brouillons d'un élément (les cartes sans élément, null, ne sont pas indexées).
    this.version(5)
      .stores({ cards: 'id, updated_at, source_path, *tags, synced, inbox_id' })
      .upgrade(tx => tx.table('meta').delete('cursor:cards'))
    // v6 : tags libres (#79). Table `tags` (registre serveur, tiré avec son curseur cursor:tags). Les tags des cartes
    // changent côté serveur (slugs → noms) → règle ci-dessus : cursor:cards supprimé (pull complet une fois) ; les
    // cartes en cache sont renommées tout de suite (affichage hors ligne juste, envois en attente corrects).
    this.version(6)
      .stores({ tags: 'id, updated_at' })
      .upgrade(async tx => {
        await tx.table('cards').toCollection().modify(renameLegacyTags)
        await tx.table('meta').delete('cursor:cards')
      })
  }
}

export const db = new VaultDB()
