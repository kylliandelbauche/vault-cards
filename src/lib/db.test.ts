import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { VaultDB, addMissingSourceTitle, addMissingTags } from './db'

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
      expect(await db.cards.get('a')).toEqual({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: [], source_title: null })
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

describe('VaultDB : migration v3 (source_title)', () => {
  it('v2 -> v3 : source_title: null sur les cartes en cache, tags et reviews conservés', async () => {
    const name = 'vault-cards-upgrade-' + crypto.randomUUID()
    const v2 = new Dexie(name)
    v2.version(1).stores({ cards: 'id, updated_at, source_path', reviews: 'id, card_id, synced, reviewed_at', meta: 'key' })
    v2.version(2).stores({ cards: 'id, updated_at, source_path, *tags' })
    await v2.table('cards').put({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: ['ia'] })
    await v2.table('reviews').put({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: 't', synced: 0 })
    v2.close()

    const db = new VaultDB(name)
    try {
      expect(await db.cards.get('a')).toEqual({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: ['ia'], source_title: null })
      expect(await db.cards.where('tags').equals('ia').count()).toBe(1)
      expect(await db.reviews.count()).toBe(1)
    } finally {
      db.close()
      await Dexie.delete(name)
    }
  })

  it('addMissingSourceTitle ne touche pas un titre déjà présent', () => {
    const withTitle: { source_title?: unknown } = { source_title: 'Mon titre' }
    const without: { source_title?: unknown } = {}
    addMissingSourceTitle(withTitle)
    addMissingSourceTitle(without)
    expect(withTitle.source_title).toBe('Mon titre')
    expect(without.source_title).toBeNull()
  })
})
