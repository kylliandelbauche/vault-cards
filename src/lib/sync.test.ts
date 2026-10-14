import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VaultDB } from './db'
import { after as afterFilter, parseCursor, pendingCount, supabaseRemote, sync, type Cursor, type Remote } from './sync'
import { buildQueue } from './session'
import type { supabase } from './supabase'
import type { Card, Review } from './types'

type ServerReview = Omit<Review, 'synced'> & { inserted_at: string }

/**
 * Faux serveur Supabase en mémoire : attribue lui-même `updated_at` / `inserted_at`,
 * ignore un `id` de review déjà présent (INSERT … ON CONFLICT DO NOTHING) et trie comme
 * la vraie requête (horodatage puis id).
 */
function fakeServer() {
  let t = Date.parse('2020-01-01T00:00:00.000Z') // volontairement loin de l'horloge de l'appareil
  const stamp = () => new Date((t += 1000)).toISOString()
  const cards = new Map<string, Card>()
  const reviews = new Map<string, ServerReview>()
  // Même filtre que la vraie requête : (horodatage, id) strictement après le curseur.
  const isAfter = (at: string, id: string, c: Cursor | null) => c === null || at > c.at || (at === c.at && id > c.id)
  const byStampThenId = <T extends { id: string }>(key: (x: T) => string) => (a: T, b: T) =>
    key(a).localeCompare(key(b)) || a.id.localeCompare(b.id)

  const server: {
    cards: Map<string, Card>
    reviews: Map<string, ServerReview>
    failPush: null | 'before' | 'after'
    pullLimit: number
    onPull?: (page: Card[]) => void
    putCard(c: Partial<Card> & { id: string }, at?: string): Card
    insertReview(r: Omit<ServerReview, 'inserted_at'>): void
    remote: { [K in keyof Remote]: Remote[K] & ReturnType<typeof vi.fn> }
  } = {
    cards,
    reviews,
    /** 'before' : échec réseau sans écriture ; 'after' : la ligne est écrite mais la réponse se perd. */
    failPush: null,
    /** Nombre maximum de lignes renvoyées par un pull (simule une page coupée par max_rows). */
    pullLimit: Infinity,
    /** Appelé après chaque page de cartes servie (pour modifier des cartes en plein pull). */
    onPull: undefined,
    putCard(c: Partial<Card> & { id: string }, at = stamp()) {
      const prev = cards.get(c.id)
      const card: Card = { deck: 'd', tags: [], source_path: `d/${c.id}.md`, front: c.id, back: c.id, deleted_at: null, ...prev, ...c, updated_at: at }
      cards.set(c.id, card)
      return card
    },
    insertReview(r: Omit<ServerReview, 'inserted_at'>) {
      reviews.set(r.id, { ...r, inserted_at: stamp() })
    },
    remote: {
      pushReviews: vi.fn(async (rows: Omit<Review, 'synced'>[]) => {
        if (server.failPush === 'before') throw new Error('réseau coupé')
        const at = stamp()
        for (const r of rows) if (!reviews.has(r.id)) reviews.set(r.id, { ...r, inserted_at: at })
        if (server.failPush === 'after') { server.failPush = null; throw new Error('délai dépassé') }
      }),
      pullCards: vi.fn(async (after: Cursor | null, limit: number) => {
        const page = [...cards.values()].filter(c => isAfter(c.updated_at, c.id, after))
          .sort(byStampThenId<Card>(c => c.updated_at)).slice(0, Math.min(limit, server.pullLimit))
        server.onPull?.(page)
        return page
      }),
      pullReviews: vi.fn(async (after: Cursor | null, limit: number) =>
        [...reviews.values()].filter(r => isAfter(r.inserted_at, r.id, after))
          .sort(byStampThenId<ServerReview>(r => r.inserted_at)).slice(0, Math.min(limit, server.pullLimit))),
    },
  }
  return server
}

const review = (id: string, card_id: string, synced: 0 | 1 = 0): Review =>
  ({ id, card_id, rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z', synced })

let db: VaultDB
beforeEach(() => { db = new VaultDB('test-' + crypto.randomUUID()) })
afterEach(async () => { await db.delete() })

describe('sync : push des reviews', () => {
  it('envoie les reviews synced: 0 puis les marque synced: 1, sans renvoyer les autres', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    await db.reviews.bulkAdd([review('r1', 'a'), review('r2', 'a', 1)])

    const res = await sync(db, server.remote)

    expect(res.pushed).toBe(1)
    expect(server.remote.pushReviews).toHaveBeenCalledWith([
      { id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z' },
    ])
    expect((await db.reviews.get('r1'))!.synced).toBe(1)
    expect(await pendingCount(db)).toBe(0)

    await sync(db, server.remote)
    expect(server.remote.pushReviews).toHaveBeenCalledTimes(1)
  })

  it('push rejoué après une réponse perdue : une seule ligne côté serveur', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    await db.reviews.add(review('r1', 'a'))
    server.failPush = 'after'

    await expect(sync(db, server.remote)).rejects.toThrow('délai dépassé')
    expect((await db.reviews.get('r1'))!.synced).toBe(0)

    await sync(db, server.remote)
    expect(server.remote.pushReviews).toHaveBeenCalledTimes(2)
    expect([...server.reviews.keys()]).toEqual(['r1'])
    expect((await db.reviews.get('r1'))!.synced).toBe(1)
  })

  it('erreur réseau au push : sync rejette, rien n’est marqué, les données locales restent', async () => {
    const server = fakeServer()
    await db.cards.add(server.putCard({ id: 'a' }))
    await db.reviews.bulkAdd([review('r1', 'a'), review('r2', 'a')])
    server.failPush = 'before'

    await expect(sync(db, server.remote)).rejects.toThrow('réseau coupé')

    expect(await pendingCount(db)).toBe(2)
    expect(await db.reviews.count()).toBe(2)
    expect(await db.cards.count()).toBe(1)
    expect(server.reviews.size).toBe(0)
  })
})

describe('sync : pull des cartes', () => {
  it('nouvelles et modifiées arrivent ; une carte supprimée garde deleted_at et sort de la file', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a', front: 'v1' })
    server.putCard({ id: 'b' })
    expect((await sync(db, server.remote)).pulledCards).toBe(2)

    server.putCard({ id: 'a', front: 'v2' })
    server.putCard({ id: 'c' })
    server.putCard({ id: 'b', deleted_at: '2026-10-13T09:00:00.000Z' })
    await sync(db, server.remote)

    expect((await db.cards.get('a'))!.front).toBe('v2')
    expect(await db.cards.get('c')).toBeDefined()
    expect((await db.cards.get('b'))!.deleted_at).toBe('2026-10-13T09:00:00.000Z')
    const queue = buildQueue(await db.cards.toArray(), [], new Date('2026-10-13T10:00:00Z'))
    expect(queue.map(i => i.card.id).sort()).toEqual(['a', 'c'])
  })

  it('sans curseur (remis à zéro par un upgrade) : pull complet qui écrase le cache avec tags + source_title, reviews intactes', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a', tags: ['ia'], source_title: 'Mon titre' })
    server.putCard({ id: 'b', tags: ['dev', 'securite'], source_title: 'Autre' })
    // Cache d'avant la mise à niveau : cartes sans tags ni titre, pas de curseur cartes, une review à pousser.
    await db.cards.bulkPut([
      { id: 'a', deck: 'd', source_path: 'd/a.md', front: 'a', back: 'a', tags: [], source_title: null, updated_at: '2019-01-01T00:00:00.000Z', deleted_at: null },
      { id: 'b', deck: 'd', source_path: 'd/b.md', front: 'b', back: 'b', tags: [], source_title: null, updated_at: '2019-01-01T00:00:00.000Z', deleted_at: null },
    ])
    await db.reviews.put(review('r1', 'a', 0))
    await sync(db, server.remote)
    expect(server.remote.pullCards).toHaveBeenCalledWith(null, 1000)
    expect(await db.cards.get('a')).toMatchObject({ tags: ['ia'], source_title: 'Mon titre' })
    expect(await db.cards.get('b')).toMatchObject({ tags: ['dev', 'securite'], source_title: 'Autre' })
    expect(await db.reviews.get('r1')).toEqual(review('r1', 'a', 1)) // seule la poussée la marque synced, rien d'autre ne change
    expect(server.reviews.has('r1')).toBe(true)
  })

  it('horodatages égaux sur plusieurs pages : chaque carte arrive une fois, aucune n’est sautée ni relue', async () => {
    const server = fakeServer()
    const same = '2020-06-01T00:00:00.000Z'
    for (const id of ['a', 'b', 'c', 'd', 'e']) server.putCard({ id }, same)

    const res = await sync(db, server.remote, { pageSize: 2 })

    expect(res.pulledCards).toBe(5)
    expect(server.remote.pullCards).toHaveBeenCalledTimes(3) // 2 + 2 + 1 (page incomplète = fin)
    expect(server.remote.pullCards.mock.calls.map(c => c[0])).toEqual([null, { at: same, id: 'b' }, { at: same, id: 'd' }])
    expect((await db.cards.toArray()).map(c => c.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect((await sync(db, server.remote, { pageSize: 2 })).pulledCards).toBe(0) // curseur strict : rien de relu
  })

  it('page coupée par le serveur (max_rows) : la suite arrive au sync suivant, à partir du curseur', async () => {
    const server = fakeServer()
    const same = '2020-06-01T00:00:00.000Z'
    server.putCard({ id: 'a' }, same)
    server.putCard({ id: 'b' }, same)
    server.pullLimit = 1

    await sync(db, server.remote)
    expect(await db.cards.count()).toBe(1)

    server.pullLimit = Infinity
    await sync(db, server.remote)
    expect(server.remote.pullCards).toHaveBeenLastCalledWith({ at: same, id: 'a' }, 1000)
    expect((await db.cards.toArray()).map(c => c.id).sort()).toEqual(['a', 'b'])
  })

  it('carte modifiée pendant un pull de plusieurs pages : aucune carte sautée', async () => {
    const server = fakeServer()
    for (const id of ['a', 'b', 'c']) server.putCard({ id })
    // Après la 1re page (a, b), « a » est modifiée : avec un décalage positionnel, « c » glisserait en page 1 et serait sautée.
    server.onPull = page => { if (page[0]?.id === 'a') server.putCard({ id: 'a', front: 'a v2' }) }

    await sync(db, server.remote, { pageSize: 2 })

    expect((await db.cards.toArray()).map(c => c.id).sort()).toEqual(['a', 'b', 'c'])
    expect((await db.cards.get('a'))!.front).toBe('a v2')
  })

  it('le curseur est la dernière ligne serveur reçue (horodatage, id), jamais l’horloge de l’appareil', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' }, '2020-03-01T00:00:00.000Z')
    server.putCard({ id: 'b' }, '2020-05-01T00:00:00.000Z')
    server.putCard({ id: 'c' }, '2020-04-01T00:00:00.000Z')

    await sync(db, server.remote)
    expect(server.remote.pullCards).toHaveBeenLastCalledWith(null, 1000)
    expect(JSON.parse((await db.meta.get('cursor:cards'))!.value)).toEqual({ at: '2020-05-01T00:00:00.000Z', id: 'b' })

    await sync(db, server.remote)
    expect(server.remote.pullCards).toHaveBeenLastCalledWith({ at: '2020-05-01T00:00:00.000Z', id: 'b' }, 1000)
  })

  it('curseur à l’ancien format (horodatage seul) : pull complet, puis curseur composite', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' }, '2020-03-01T00:00:00.000Z')
    server.putCard({ id: 'b' }, '2020-05-01T00:00:00.000Z')
    await db.meta.put({ key: 'cursor:cards', value: '2020-04-01T00:00:00.000Z' })

    await sync(db, server.remote)

    expect(server.remote.pullCards).toHaveBeenCalledWith(null, 1000)
    expect(await db.cards.count()).toBe(2)
    expect(parseCursor((await db.meta.get('cursor:cards'))!.value)).toEqual({ at: '2020-05-01T00:00:00.000Z', id: 'b' })
  })
})

describe('parseCursor', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['2026-10-13T00:00:00+00:00', null],
    ['{"at":1}', null],
    ['null', null],
    ['{"at":"2026-10-13T00:00:00+00:00","id":"x"}', { at: '2026-10-13T00:00:00+00:00', id: 'x' }],
  ])('%s → %o', (value, expected) => {
    expect(parseCursor(value)).toEqual(expected)
  })
})

describe('sync : pull des reviews', () => {
  it('les reviews d’un autre appareil arrivent avec synced: 1', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    server.insertReview({ id: 'autre', card_id: 'a', rating: 2, reviewed_at: '2026-10-12T08:00:00.000Z' })

    const res = await sync(db, server.remote)

    expect(res.pulledReviews).toBe(1)
    expect(await db.reviews.get('autre')).toEqual({ id: 'autre', card_id: 'a', rating: 2, reviewed_at: '2026-10-12T08:00:00.000Z', synced: 1 })
    expect(await pendingCount(db)).toBe(0)
    const inserted = server.reviews.get('autre')!.inserted_at
    expect(parseCursor((await db.meta.get('cursor:reviews'))!.value)).toEqual({ at: inserted, id: 'autre' })
  })
})

/** Faux client supabase-js : enregistre la chaîne d'appels et renvoie des pages de `rows`. */
function fakeClient(rows: Record<string, unknown[]> = {}, error: { message: string } | null = null) {
  const calls: { table: string; ops: [string, ...unknown[]][] }[] = []
  const client = {
    from(table: string) {
      const entry = { table, ops: [] as [string, ...unknown[]][] }
      calls.push(entry)
      let page = [...(rows[table] ?? [])]
      const builder = {
        select: (...a: unknown[]) => { entry.ops.push(['select', ...a]); return builder },
        or: (...a: unknown[]) => { entry.ops.push(['or', ...a]); return builder },
        order: (...a: unknown[]) => { entry.ops.push(['order', ...a]); return builder },
        limit: (n: number) => { entry.ops.push(['limit', n]); page = page.slice(0, n); return builder },
        upsert: (...a: unknown[]) => { entry.ops.push(['upsert', ...a]); return builder },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(error ? { data: null, error } : { data: page, error: null }).then(ok, ko),
      }
      return builder
    },
  }
  return { client: client as unknown as typeof supabase, calls }
}

describe('supabaseRemote', () => {
  it('pushReviews : INSERT … ON CONFLICT (id) DO NOTHING, jamais de mise à jour', async () => {
    const { client, calls } = fakeClient()
    const rows = [{ id: 'r1', card_id: 'a', rating: 3 as const, reviewed_at: '2026-10-13T08:00:00.000Z' }]
    await supabaseRemote(client).pushReviews(rows)
    expect(calls).toEqual([{ table: 'reviews', ops: [['upsert', rows, { onConflict: 'id', ignoreDuplicates: true }]] }])
  })

  it('pushReviews lève si Supabase renvoie une erreur', async () => {
    const { client } = fakeClient({}, { message: 'permission denied' })
    await expect(supabaseRemote(client).pushReviews([])).rejects.toThrow('permission denied')
  })

  it('pullCards : une page après le curseur (keyset), tri stable (updated_at puis id), limitée', async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ id: String(i).padStart(4, '0') }))
    const { client, calls } = fakeClient({ cards: all })
    const at = '2026-10-13T00:00:00.123456+00:00'
    const got = await supabaseRemote(client).pullCards({ at, id: 'abc' }, 1000)
    expect(got).toHaveLength(1000)
    expect(calls).toHaveLength(1)
    expect(calls[0].ops).toEqual([
      ['select', 'id, deck, source_path, source_title, tags, front, back, updated_at, deleted_at'],
      ['or', `updated_at.gt."${at}",and(updated_at.eq."${at}",id.gt."abc")`],
      ['order', 'updated_at'],
      ['order', 'id'],
      ['limit', 1000],
    ])
  })

  it('pullReviews sans curseur : tout, trié par inserted_at puis id', async () => {
    const { client, calls } = fakeClient({ reviews: [] })
    await supabaseRemote(client).pullReviews(null, 1000)
    expect(calls[0].ops).toEqual([
      ['select', 'id, card_id, rating, reviewed_at, inserted_at'],
      ['order', 'inserted_at'],
      ['order', 'id'],
      ['limit', 1000],
    ])
  })

  it('filtre keyset : (col > at) ou (col = at et id > lastId)', () => {
    expect(afterFilter('inserted_at', { at: 'T', id: 'r1' })).toBe('inserted_at.gt."T",and(inserted_at.eq."T",id.gt."r1")')
  })

  it('un pull lève si Supabase renvoie une erreur', async () => {
    const { client } = fakeClient({}, { message: 'JWT expired' })
    await expect(supabaseRemote(client).pullCards(null, 1000)).rejects.toThrow('JWT expired')
  })
})
