import { deleteCard, updateCard } from '../../lib/cards'
import type { VaultDB } from '../../lib/db'
import type { ReviewStore } from './useReviewSession'

/** ReviewStore adossé au cache IndexedDB ; une review ou une carte écrite part avec `synced: 0` au prochain sync. */
export const dexieStore = (db: VaultDB): ReviewStore => ({
  loadCards: () => db.cards.toArray(),
  loadReviews: () => db.reviews.toArray(),
  addReview: async r => { await db.reviews.add(r) },
  updateCard: (id, patch) => updateCard(db, id, patch),
  deleteCard: id => deleteCard(db, id),
})
