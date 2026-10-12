import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { VaultDB, addMissingTags } from './db'

describe('VaultDB : migration v2 (tags)', () => {
  it('une carte en cache sans tags reçoit tags: [] après upgrade, sans perdre le reste', async () => {
    const name = 'vault-cards-upgrade-' + crypto.randomUUID()
    const v1 = new Dexie(name)
    v1.version(1).stores({ cards: 'id, updated_at, source_path', reviews: 'id, card_id, synced, reviewed_at', meta: 'key' })
    await v1.table('cards').put({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null })
    await v1.table('reviews').put({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: 't', synced: 0 })
    v1.close()

    const db = new VaultDB(name)
    try {
      expect(await db.cards.get('a')).toEqual({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: [] })
      expect(await db.reviews.count()).toBe(1)
    } finally {
      db.close()
      await Dexie.delete(name)
    }
  })

  it('addMissingTags ne touche pas des tags déjà présents', () => {
    const withTags: { tags?: unknown } = { tags: ['ia'] }
    const without: { tags?: unknown } = {}
    addMissingTags(withTags)
    addMissingTags(without)
    expect(withTags.tags).toEqual(['ia'])
    expect(without.tags).toEqual([])
  })
})
