import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { VaultDB, addMissingSource, addMissingSourceTitle, addMissingTags } from './db'

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
      expect(await db.cards.get('a')).toEqual({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: [], source_title: null, source: 'vault' })
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
      expect(await db.cards.get('a')).toEqual({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: ['ia'], source_title: null, source: 'vault' })
      expect(await db.cards.where('tags').equals('ia').count()).toBe(1)
      expect(await db.reviews.count()).toBe(1)
    } finally {
      db.close()
      await Dexie.delete(name)
    }
  })

  it('v2 -> v3 : supprime cursor:cards (pull complet), garde cursor:reviews et les reviews non synchronisées', async () => {
    const name = 'vault-cards-upgrade-' + crypto.randomUUID()
    const v2 = new Dexie(name)
    v2.version(1).stores({ cards: 'id, updated_at, source_path', reviews: 'id, card_id, synced, reviewed_at', meta: 'key' })
    v2.version(2).stores({ cards: 'id, updated_at, source_path, *tags' })
    await v2.table('cards').put({ id: 'a', deck: 'd', source_path: 'd/a.md', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: [] })
    await v2.table('reviews').bulkPut([
      { id: 'r1', card_id: 'a', rating: 3, reviewed_at: 't', synced: 0 },
      { id: 'r2', card_id: 'a', rating: 2, reviewed_at: 't', synced: 1 },
    ])
    await v2.table('meta').bulkPut([{ key: 'cursor:cards', value: '2026-10-13T10:00:00.000000+00:00' }, { key: 'cursor:reviews', value: '2026-10-13T09:00:00.000000+00:00' }])
    v2.close()

    const db = new VaultDB(name)
    try {
      expect(await db.cards.get('a')).toMatchObject({ id: 'a', source_title: null })
      expect(await db.meta.get('cursor:cards')).toBeUndefined()
      expect(await db.meta.get('cursor:reviews')).toEqual({ key: 'cursor:reviews', value: '2026-10-13T09:00:00.000000+00:00' })
      expect((await db.reviews.toArray()).map(r => [r.id, r.synced]).sort()).toEqual([['r1', 0], ['r2', 1]])
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

describe('VaultDB : migration v4 (cartes manuelles, #54)', () => {
  it('v3 -> v4 : source vault sur les cartes en cache, cursor:cards supprimé, reviews et cursor:reviews intacts', async () => {
    const name = 'vault-cards-upgrade-' + crypto.randomUUID()
    const v3 = new Dexie(name)
    v3.version(1).stores({ cards: 'id, updated_at, source_path', reviews: 'id, card_id, synced, reviewed_at', meta: 'key' })
    v3.version(2).stores({ cards: 'id, updated_at, source_path, *tags' })
    v3.version(3).stores({ cards: 'id, updated_at, source_path, *tags' })
    await v3.table('cards').put({ id: 'a', deck: 'd', source_path: 'd/a.md', source_title: 'T', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: ['ia'] })
    await v3.table('reviews').put({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: 't', synced: 0 })
    await v3.table('meta').bulkPut([{ key: 'cursor:cards', value: '{"at":"x","id":"a"}' }, { key: 'cursor:reviews', value: '{"at":"y","id":"r"}' }])
    v3.close()

    const db = new VaultDB(name)
    try {
      expect(await db.cards.get('a')).toEqual({ id: 'a', source: 'vault', deck: 'd', source_path: 'd/a.md', source_title: 'T', front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: ['ia'] })
      expect(await db.meta.get('cursor:cards')).toBeUndefined()
      expect(await db.meta.get('cursor:reviews')).toEqual({ key: 'cursor:reviews', value: '{"at":"y","id":"r"}' })
      expect((await db.reviews.get('r1'))!.synced).toBe(0)
      // Index synced : seules les cartes à envoyer y figurent.
      await db.cards.add({ id: 'm', source: 'manual', deck: null, source_path: null, tags: ['ia'], front: 'Q', back: 'R', updated_at: 't', deleted_at: null, synced: 0 })
      expect(await db.cards.where('synced').equals(0).primaryKeys()).toEqual(['m'])
    } finally {
      db.close()
      await Dexie.delete(name)
    }
  })

  it('addMissingSource ne touche pas une source déjà présente', () => {
    const manual: { source?: unknown } = { source: 'manual' }
    const without: { source?: unknown } = {}
    addMissingSource(manual)
    addMissingSource(without)
    expect(manual.source).toBe('manual')
    expect(without.source).toBe('vault')
  })
})

describe('VaultDB : migration v5 (boîte de réception, #55)', () => {
  it('v4 -> v5 : cursor:cards supprimé, cartes et cursor:reviews intacts, index inbox_id', async () => {
    const name = 'vault-cards-upgrade-' + crypto.randomUUID()
    const v4 = new Dexie(name)
    v4.version(1).stores({ cards: 'id, updated_at, source_path', reviews: 'id, card_id, synced, reviewed_at', meta: 'key' })
    v4.version(2).stores({ cards: 'id, updated_at, source_path, *tags' })
    v4.version(3).stores({ cards: 'id, updated_at, source_path, *tags' })
    v4.version(4).stores({ cards: 'id, updated_at, source_path, *tags, synced' })
    const old = { id: 'a', source: 'manual', deck: null, source_path: null, front: 'Q', back: 'R', updated_at: 't', deleted_at: null, tags: ['ia'], synced: 0 }
    await v4.table('cards').put(old)
    await v4.table('meta').bulkPut([{ key: 'cursor:cards', value: '{"at":"x","id":"a"}' }, { key: 'cursor:reviews', value: '{"at":"y","id":"r"}' }])
    v4.close()

    const db = new VaultDB(name)
    try {
      expect(await db.cards.get('a')).toEqual(old)
      expect(await db.meta.get('cursor:cards')).toBeUndefined()
      expect(await db.meta.get('cursor:reviews')).toEqual({ key: 'cursor:reviews', value: '{"at":"y","id":"r"}' })
      await db.cards.add({ id: 'd', source: 'inbox', status: 'draft', inbox_id: 'i1', deck: null, source_path: null, tags: ['ia'], front: 'Q', back: 'R', updated_at: 't', deleted_at: null })
      expect(await db.cards.where('inbox_id').equals('i1').primaryKeys()).toEqual(['d'])
    } finally {
      db.close()
      await Dexie.delete(name)
    }
  })
})
