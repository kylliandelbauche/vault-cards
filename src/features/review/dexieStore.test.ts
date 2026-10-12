import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VaultDB } from '../../lib/db'
import { pendingCount } from '../../lib/sync'
import type { Card, Review } from '../../lib/types'
import { dexieStore } from './dexieStore'

const card: Card = { id: 'a', deck: 'd', tags: [], source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: '2026-10-13T00:00:00+00:00', deleted_at: null }
const review: Review = { id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z', synced: 0 }

let db: VaultDB
beforeEach(() => { db = new VaultDB('test-' + crypto.randomUUID()) })
afterEach(async () => { await db.delete() })

describe('dexieStore', () => {
  it('lit les cartes et les reviews du cache local', async () => {
    await db.cards.add(card)
    await db.reviews.add({ ...review, synced: 1 })
    const store = dexieStore(db)
    expect(await store.loadCards()).toEqual([card])
    expect(await store.loadReviews()).toEqual([{ ...review, synced: 1 }])
  })

  it('addReview écrit la review en attente de push', async () => {
    const store = dexieStore(db)
    await store.addReview(review)
    expect(await db.reviews.get('r1')).toEqual(review)
    expect(await pendingCount(db)).toBe(1)
  })

  it('addReview rejette si l’écriture échoue (id déjà présent)', async () => {
    const store = dexieStore(db)
    await store.addReview(review)
    await expect(store.addReview(review)).rejects.toThrow()
  })
})
