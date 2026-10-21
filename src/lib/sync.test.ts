import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VaultDB } from './db'
import { after as afterFilter, cardsOutbox, outboxQueue, parseCursor, pendingCount, reviewsOutbox, supabaseRemote, sync, SyncError, type Cursor, type ManualCardRow, type OutboxQueue, type PushResult, type Remote } from './sync'
import { createManualCard, deleteManualCard, updateCard } from './cards'
import { acceptDraft, rejectDraft, updateDraft } from './drafts'
import { buildQueue } from './session'
import type { supabase } from './supabase'
import { tagKey } from '../../shared/tags'
import type { Card, Review, Tag } from './types'

type ServerReview = Omit<Review, 'synced' | 'free'> & { inserted_at: string }

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
  const tags = new Map<string, Tag>()
  // Même filtre que la vraie requête : (horodatage, id) strictement après le curseur.
  const isAfter = (at: string, id: string, c: Cursor | null) => c === null || at > c.at || (at === c.at && id > c.id)
  const byStampThenId = <T extends { id: string }>(key: (x: T) => string) => (a: T, b: T) =>
    key(a).localeCompare(key(b)) || a.id.localeCompare(b.id)

  const server: {
    cards: Map<string, Card>
    reviews: Map<string, ServerReview>
    tags: Map<string, Tag>
    failPush: null | 'before' | 'after'
    failCardPush: null | 'before' | 'after'
    enforceFk: boolean
    pullLimit: number
    onPull?: (page: Card[]) => void
    putCard(c: Partial<Card> & { id: string }, at?: string): Card
    insertReview(r: Omit<ServerReview, 'inserted_at'>): void
    remote: { [K in keyof Remote]: Remote[K] & ReturnType<typeof vi.fn> }
  } = {
    cards,
    reviews,
    tags,
    /** 'before' : échec réseau sans écriture ; 'after' : la ligne est écrite mais la réponse se perd. */
    failPush: null,
    /** Idem pour l'envoi des cartes manuelles. */
    failCardPush: null,
    /** Clé étrangère reviews.card_id : une review sur une carte absente du serveur fait échouer tout l'envoi. */
    enforceFk: false,
    /** Nombre maximum de lignes renvoyées par un pull (simule une page coupée par max_rows). */
    pullLimit: Infinity,
    /** Appelé après chaque page de cartes servie (pour modifier des cartes en plein pull). */
    onPull: undefined,
    putCard(c: Partial<Card> & { id: string }, at = stamp()) {
      const prev = cards.get(c.id)
      const card: Card = { source: 'vault', deck: 'd', tags: [], source_path: `d/${c.id}.md`, front: c.id, back: c.id, deleted_at: null, ...prev, ...c, updated_at: at }
      // Trigger cards_tags_sync (#79) : orthographe d'un tag existant reprise ; tags créés pour une carte active vivante.
      const known = new Map([...tags.values()].map(t => [tagKey(t.name), t.name]))
      card.tags = [...new Map(card.tags.map(n => [tagKey(n), known.get(tagKey(n)) ?? n])).values()]
      if (card.status !== 'draft' && card.deleted_at === null) {
        for (const name of card.tags) if (!known.has(tagKey(name))) {
          const id = `tag-${tags.size + 1}`
          tags.set(id, { id, name, updated_at: stamp() })
          known.set(tagKey(name), name)
        }
      }
      cards.set(c.id, card)
      return card
    },
    insertReview(r: Omit<ServerReview, 'inserted_at'>) {
      reviews.set(r.id, { ...r, inserted_at: stamp() })
    },
    remote: {
      pushReviews: vi.fn(async (rows: Omit<Review, 'synced' | 'free'>[]) => {
        if (server.failPush === 'before') throw new Error('réseau coupé')
        if (server.enforceFk && rows.some(r => !cards.has(r.card_id))) throw new Error('violates foreign key constraint "reviews_card_id_fkey"')
        const at = stamp()
        for (const r of rows) if (!reviews.has(r.id)) reviews.set(r.id, { ...r, inserted_at: at })
        if (server.failPush === 'after') { server.failPush = null; throw new Error('délai dépassé') }
      }),
      // Même sémantique que supabaseRemote.pushCards : insertion si absente, sinon mise à jour du contenu
      // d'une carte manual (une carte vault n'est jamais modifiable : erreur).
      pushCards: vi.fn(async (rows: ManualCardRow[]): Promise<PushResult> => {
        if (server.failCardPush === 'before') throw new Error('réseau coupé (cartes)')
        const failed: NonNullable<PushResult['failed']> = []
        const stale: string[] = []
        for (const r of rows) {
          const prev = cards.get(r.id)
          if (r.source === 'inbox') {
            // Carte de la boîte de réception (#55) : UPDATE seul, jamais d'insertion ; status seulement s'il est envoyé ;
            // l’échec d'une carte n'arrête pas les autres.
            if (prev?.source !== 'inbox') { failed.push({ id: r.id, error: new Error(`carte ${r.id} : aucune ligne modifiée`) }); continue }
            server.putCard({ id: r.id, front: r.front, back: r.back, tags: r.tags, deleted_at: r.deleted_at, ...(r.status ? { status: r.status } : {}) })
            continue
          }
          if (r.source === 'vault') {
            // Carte du vault (#79, décision #73) : UPDATE seul de front, back, tags, deleted_at.
            if (prev?.source !== 'vault') { failed.push({ id: r.id, error: new Error(`carte ${r.id} : aucune ligne modifiée`) }); continue }
            server.putCard({ id: r.id, front: r.front, back: r.back, tags: r.tags, deleted_at: r.deleted_at })
            continue
          }
          if (prev && prev.source !== 'manual') throw new Error(`carte ${r.id} : 0 ligne modifiée`)
          server.putCard({ ...r, source: 'manual', deck: null, source_path: null, source_title: null })
        }
        if (server.failCardPush === 'after') { server.failCardPush = null; throw new Error('délai dépassé (cartes)') }
        return { failed, stale }
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
      pullTags: vi.fn(async (after: Cursor | null, limit: number) =>
        [...tags.values()].filter(t => isAfter(t.updated_at, t.id, after))
          .sort(byStampThenId<Tag>(t => t.updated_at)).slice(0, Math.min(limit, server.pullLimit))),
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

    // Pull coupé lui aussi : rien ne confirme r1, elle reste à envoyer et sera renvoyée.
    server.remote.pullReviews.mockRejectedValueOnce(new Error('hors ligne'))
    await expect(sync(db, server.remote)).rejects.toThrow('délai dépassé')
    expect((await db.reviews.get('r1'))!.synced).toBe(0)

    await sync(db, server.remote)
    expect(server.remote.pushReviews).toHaveBeenCalledTimes(2)
    expect([...server.reviews.keys()]).toEqual(['r1'])
    expect((await db.reviews.get('r1'))!.synced).toBe(1)
  })

  it('erreur réseau au push : sync rejette, rien n’est marqué, les données locales restent (le pull a lieu)', async () => {
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

describe('sync : push et pull indépendants', () => {
  it('push en échec : le pull a lieu quand même ; SyncError dit ce qui a été tiré ; les reviews repartent au sync suivant', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    server.putCard({ id: 'b' })
    await db.reviews.add(review('r1', 'a'))
    server.failPush = 'before'

    const err = await sync(db, server.remote).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SyncError)
    expect((err as SyncError).message).toBe('réseau coupé')
    expect((err as SyncError).result).toEqual({ pushed: 0, pulledCards: 2, pulledReviews: 0, pulledTags: 0 })
    expect(await db.cards.count()).toBe(2)
    expect((await db.reviews.get('r1'))!.synced).toBe(0)

    server.failPush = null
    expect(await sync(db, server.remote)).toEqual({ pushed: 1, pulledCards: 0, pulledReviews: 0, pulledTags: 0 })
    expect((await db.reviews.get('r1'))!.synced).toBe(1)
  })

  it('pull en échec après un push réussi : les reviews restent marquées envoyées, SyncError', async () => {
    const server = fakeServer()
    await db.reviews.add(review('r1', 'a'))
    server.remote.pullCards.mockRejectedValueOnce(new Error('JWT expired'))

    const err = await sync(db, server.remote).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SyncError)
    expect((err as SyncError).result.pushed).toBe(1)
    expect(await pendingCount(db)).toBe(0)
  })

  it('push et pull en échec : les deux erreurs dans le message', async () => {
    const server = fakeServer()
    await db.reviews.add(review('r1', 'a'))
    server.failPush = 'before'
    server.remote.pullCards.mockRejectedValueOnce(new Error('hors ligne'))
    await expect(sync(db, server.remote)).rejects.toThrow('réseau coupé ; hors ligne')
  })
})

describe('sync : cas limites (#22)', () => {
  it('pull en échec : les curseurs ne bougent pas, rien n’est écrit', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    server.insertReview({ id: 'autre', card_id: 'a', rating: 2, reviewed_at: '2026-10-12T08:00:00.000Z' })
    await sync(db, server.remote)
    const before = await db.meta.toArray()
    server.putCard({ id: 'b' })
    server.insertReview({ id: 'autre2', card_id: 'b', rating: 3, reviewed_at: '2026-10-12T09:00:00.000Z' })

    server.remote.pullCards.mockRejectedValueOnce(new Error('hors ligne'))
    await expect(sync(db, server.remote)).rejects.toThrow('hors ligne')

    expect(await db.meta.toArray()).toEqual(before)
    expect(await db.cards.get('b')).toBeUndefined()
    expect(await db.reviews.get('autre2')).toBeUndefined()
  })

  it('note donnée pendant un push : reste synced: 0, puis part au sync suivant', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    await db.reviews.add(review('r1', 'a'))
    const push = server.remote.pushReviews.getMockImplementation() as Remote['pushReviews']
    server.remote.pushReviews.mockImplementationOnce(async (rows: Parameters<Remote['pushReviews']>[0]) => {
      await db.reviews.add(review('r2', 'a')) // l'utilisateur note une carte pendant que le push est en vol
      await push(rows)
    })

    expect((await sync(db, server.remote)).pushed).toBe(1)
    expect((await db.reviews.get('r1'))!.synced).toBe(1)
    expect((await db.reviews.get('r2'))!.synced).toBe(0)
    expect(server.reviews.has('r2')).toBe(false)

    expect((await sync(db, server.remote)).pushed).toBe(1)
    expect(server.remote.pushReviews).toHaveBeenLastCalledWith([{ id: 'r2', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z' }])
    expect(await pendingCount(db)).toBe(0)
  })
})

describe('sync : anti-boucle (#22)', () => {
  it('serveur qui ignore le curseur (pages pleines identiques) : le pull s’arrête dès que le curseur n’avance plus', async () => {
    const server = fakeServer()
    const page = [server.putCard({ id: 'a' }), server.putCard({ id: 'b' })]
    server.remote.pullCards.mockImplementation(async () => page)

    await sync(db, server.remote, { pageSize: 2 })

    expect(server.remote.pullCards).toHaveBeenCalledTimes(2) // 1re page, puis la même : arrêt
    expect(await db.cards.count()).toBe(2)
  })
})

describe('sync : files d’envoi (préparation #54)', () => {
  const queue = (name: string, log: string[], { fail = false, count = 1 } = {}): OutboxQueue => ({
    count: async () => count,
    push: async () => { log.push(name); if (fail) throw new Error(`${name} refusé`); return count },
  })

  it('les files partent dans l’ordre, chacune tentée même si une précédente échoue ; le sync échoue quand même, le pull a lieu', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    const log: string[] = []

    const err = await sync(db, server.remote, { outbox: [queue('cartes', log, { fail: true }), queue('reviews', log, { count: 2 })] }).catch((e: unknown) => e)

    expect(log).toEqual(['cartes', 'reviews'])
    expect(err).toBeInstanceOf(SyncError)
    expect((err as SyncError).message).toBe('cartes refusé')
    expect((err as SyncError).result.pushed).toBe(2) // ce que les autres files ont envoyé compte
    expect(await db.cards.count()).toBe(1)
    expect((await sync(db, server.remote, { outbox: [queue('cartes', log), queue('reviews', log, { count: 2 })] })).pushed).toBe(3)
    expect(log).toEqual(['cartes', 'reviews', 'cartes', 'reviews'])
  })

  it('deux files en échec : les deux erreurs sont remontées', async () => {
    const err = await sync(db, fakeServer().remote, { outbox: [queue('cartes', [], { fail: true }), queue('reviews', [], { fail: true })] }).catch((e: unknown) => e)
    expect((err as SyncError).message).toBe('cartes refusé ; reviews refusé')
  })

  it('pendingCount additionne toutes les files', async () => {
    expect(await pendingCount(db, [queue('a', [], { count: 2 }), queue('b', [], { count: 3 })])).toBe(5)
  })

  it('outboxQueue : rien en attente → aucun envoi ; envoi en échec → rien n’est marqué', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('hors ligne')).mockResolvedValue(undefined)
    const markSent = vi.fn(async () => {})
    let rows = [] as string[]
    const q = outboxQueue<string>({ count: async () => rows.length, pending: async () => rows, send, markSent })
    expect(await q.push(db, fakeServer().remote)).toBe(0)
    expect(send).not.toHaveBeenCalled()
    rows = ['x']
    await expect(q.push(db, fakeServer().remote)).rejects.toThrow('hors ligne')
    expect(markSent).not.toHaveBeenCalled()
    expect(await q.push(db, fakeServer().remote)).toBe(1)
    expect(markSent).toHaveBeenCalledWith(db, ['x'])
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
      { id: 'a', source: 'vault', deck: 'd', source_path: 'd/a.md', front: 'a', back: 'a', tags: [], source_title: null, updated_at: '2019-01-01T00:00:00.000Z', deleted_at: null },
      { id: 'b', source: 'vault', deck: 'd', source_path: 'd/b.md', front: 'b', back: 'b', tags: [], source_title: null, updated_at: '2019-01-01T00:00:00.000Z', deleted_at: null },
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

describe('sync : seuls les vrais changements comptent (pas de restart() inutile)', () => {
  it('syncs répétés sans changement serveur : 0 carte, 0 review ; nos propres reviews relues ne comptent pas', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    expect(await sync(db, server.remote)).toEqual({ pushed: 0, pulledCards: 1, pulledReviews: 0, pulledTags: 0 })
    expect(await sync(db, server.remote)).toEqual({ pushed: 0, pulledCards: 0, pulledReviews: 0, pulledTags: 0 })

    await db.reviews.add(review('r1', 'a'))
    // La review poussée revient par le pull : déjà connue localement, ce n'est pas un changement.
    expect(await sync(db, server.remote)).toEqual({ pushed: 1, pulledCards: 0, pulledReviews: 0, pulledTags: 0 })
    expect(await sync(db, server.remote)).toEqual({ pushed: 0, pulledCards: 0, pulledReviews: 0, pulledTags: 0 })
  })

  it('review locale déjà sur le serveur (réponse du push perdue) : le pull la marque synced: 1 sans la compter', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    server.insertReview({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z' })
    await db.reviews.add(review('r1', 'a'))
    server.remote.pushReviews.mockRejectedValueOnce(new Error('délai dépassé'))

    await expect(sync(db, server.remote)).rejects.toThrow('délai dépassé')
    await sync(db, server.remote)

    expect(await db.reviews.get('r1')).toEqual(review('r1', 'a', 1))
  })

  it('révision libre : le marqueur local free n’est jamais envoyé et survit à la relecture par le pull', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    await db.reviews.add({ ...review('r1', 'a'), free: true })
    await sync(db, server.remote)
    expect(server.remote.pushReviews).toHaveBeenCalledWith([{ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z' }])
    expect(await db.reviews.get('r1')).toEqual({ ...review('r1', 'a', 1), free: true })
  })

  it('review d’un autre appareil : comptée une fois', async () => {
    const server = fakeServer()
    server.putCard({ id: 'a' })
    await sync(db, server.remote)
    server.insertReview({ id: 'autre', card_id: 'a', rating: 2, reviewed_at: '2026-10-12T08:00:00.000Z' })
    expect((await sync(db, server.remote)).pulledReviews).toBe(1)
    expect((await sync(db, server.remote)).pulledReviews).toBe(0)
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
type Ops = [string, ...unknown[]][]
function fakeClient(rows: Record<string, unknown[] | ((ops: Ops) => unknown[])> = {}, error: { message: string } | null = null) {
  const calls: { table: string; ops: [string, ...unknown[]][] }[] = []
  const client = {
    from(table: string) {
      const entry = { table, ops: [] as [string, ...unknown[]][] }
      calls.push(entry)
      const source = rows[table] ?? []
      let limit = Infinity
      const builder = {
        select: (...a: unknown[]) => { entry.ops.push(['select', ...a]); return builder },
        or: (...a: unknown[]) => { entry.ops.push(['or', ...a]); return builder },
        order: (...a: unknown[]) => { entry.ops.push(['order', ...a]); return builder },
        limit: (n: number) => { entry.ops.push(['limit', n]); limit = n; return builder },
        upsert: (...a: unknown[]) => { entry.ops.push(['upsert', ...a]); return builder },
        update: (...a: unknown[]) => { entry.ops.push(['update', ...a]); return builder },
        eq: (...a: unknown[]) => { entry.ops.push(['eq', ...a]); return builder },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          const page = (typeof source === 'function' ? source(entry.ops) : [...source]).slice(0, limit)
          return Promise.resolve(error ? { data: null, error } : { data: page, error: null }).then(ok, ko)
        },
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
      ['select', 'id, source, status, inbox_id, deck, source_path, source_title, tags, front, back, created_at, updated_at, deleted_at'],
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

  it('pushCards : INSERT … ON CONFLICT (id) DO NOTHING en un appel, puis UPDATE du contenu des seules cartes déjà présentes', async () => {
    const rows: ManualCardRow[] = [
      { id: 'neuve', front: 'Q1', back: 'R1', tags: ['ia'], deleted_at: null },
      { id: 'connue', front: 'Q2', back: 'R2', tags: ['dev', 'ia'], deleted_at: '2026-10-14T10:00:00.000Z' },
    ]
    // Le serveur renvoie les lignes réellement insérées (la carte déjà présente est ignorée) ; l'update renvoie sa ligne.
    const { client, calls } = fakeClient({ cards: ops => (ops[0][0] === 'upsert' ? [{ id: 'neuve' }] : [{ id: 'connue' }]) })
    await supabaseRemote(client).pushCards(rows)
    expect(calls).toEqual([
      { table: 'cards', ops: [['upsert', rows.map(r => ({ ...r, source: 'manual' })), { onConflict: 'id', ignoreDuplicates: true }], ['select', 'id']] },
      { table: 'cards', ops: [['update', { front: 'Q2', back: 'R2', tags: ['dev', 'ia'], deleted_at: '2026-10-14T10:00:00.000Z' }], ['eq', 'id', 'connue'], ['eq', 'source', 'manual'], ['select', 'id']] },
    ])
  })

  it('pushCards : rien à envoyer → aucun appel ; update sans ligne (carte vault ou invisible) → erreur', async () => {
    const empty = fakeClient()
    await supabaseRemote(empty.client).pushCards([])
    expect(empty.calls).toEqual([])
    const { client } = fakeClient({ cards: [] })
    const res = await supabaseRemote(client).pushCards([{ id: 'x', front: 'Q', back: 'R', tags: ['ia'], deleted_at: null }])
    expect(res?.failed?.map(f => [f.id, (f.error as Error).message])).toEqual([['x', 'carte x : aucune ligne modifiée']])
  })

  it('pushCards : carte inbox (#55) → UPDATE seul (filtre source inbox), status envoyé seulement s’il vaut active', async () => {
    const rows: ManualCardRow[] = [
      { id: 'd', source: 'inbox', status: 'active', front: 'Q', back: 'R', tags: ['ia'], deleted_at: null },
      { id: 'r', source: 'inbox', front: 'Q2', back: 'R2', tags: ['dev'], deleted_at: '2026-10-15T10:00:00.000Z' },
    ]
    const { client, calls } = fakeClient({ cards: ops => [{ id: (ops[1][2] as string) }] })
    expect(await supabaseRemote(client).pushCards(rows)).toEqual({ failed: [], stale: [] })
    expect(calls).toEqual([
      { table: 'cards', ops: [['update', { front: 'Q', back: 'R', tags: ['ia'], deleted_at: null, status: 'active' }], ['eq', 'id', 'd'], ['eq', 'source', 'inbox'], ['select', 'id']] },
      { table: 'cards', ops: [['update', { front: 'Q2', back: 'R2', tags: ['dev'], deleted_at: '2026-10-15T10:00:00.000Z' }], ['eq', 'id', 'r'], ['eq', 'source', 'inbox'], ['select', 'id']] },
    ])
  })

  it('pushCards : l’échec d’une carte n’arrête pas les autres ; 23514 (déjà acceptée ailleurs) → stale, pas un échec', async () => {
    const rows: ManualCardRow[] = [
      { id: 'absente', source: 'inbox', front: 'Q', back: 'R', tags: ['ia'], deleted_at: null },
      { id: 'conflit', source: 'inbox', front: 'Q', back: 'R', tags: ['ia'], deleted_at: null },
      { id: 'ok', source: 'inbox', status: 'active', front: 'Q', back: 'R', tags: ['ia'], deleted_at: null },
    ]
    const { client, calls } = fakeClient({ cards: ops => (ops[1][2] === 'ok' ? [{ id: 'ok' }] : []) })
    const errorFor = { conflit: { message: 'une carte active ne repasse jamais en brouillon', code: '23514' } } as Record<string, { message: string; code: string }>
    const real = client.from.bind(client) as unknown as (t: string) => unknown
    const wrapped = { ...client, from: (t: string) => {
      const b = real(t) as unknown as { eq: (c: string, v: string) => unknown; then: PromiseLike<unknown>['then'] }
      const eq = b.eq.bind(b)
      let id = ''
      b.eq = (c: string, v: string) => { if (c === 'id') id = v; return eq(c, v) }
      const then = b.then.bind(b)
      b.then = ((ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        errorFor[id] ? Promise.resolve({ data: null, error: errorFor[id] }).then(ok, ko) : then(ok, ko)) as PromiseLike<unknown>['then']
      return b
    } } as unknown as typeof supabase
    const res = await supabaseRemote(wrapped).pushCards(rows)
    expect(res?.stale).toEqual(['conflit'])
    expect(res?.failed?.map(f => f.id)).toEqual(['absente'])
    expect(calls.map(c => c.ops[1])).toEqual([['eq', 'id', 'absente'], ['eq', 'id', 'conflit'], ['eq', 'id', 'ok']])
  })

  it('pushCards lève si Supabase renvoie une erreur', async () => {
    const { client } = fakeClient({}, { message: 'new row violates row-level security policy' })
    await expect(supabaseRemote(client).pushCards([{ id: 'x', front: 'Q', back: 'R', tags: ['ia'], deleted_at: null }]))
      .rejects.toThrow('row-level security')
  })

  it('un pull lève si Supabase renvoie une erreur', async () => {
    const { client } = fakeClient({}, { message: 'JWT expired' })
    await expect(supabaseRemote(client).pullCards(null, 1000)).rejects.toThrow('JWT expired')
  })
})

describe('sync : cartes manuelles (#54)', () => {
  const NOW = new Date('2026-10-14T10:00:00.000Z')

  it('créée hors ligne puis notée : au sync (OUTBOX par défaut), la carte part avant sa review (clé étrangère), puis tout est à jour', async () => {
    const server = fakeServer()
    server.enforceFk = true
    const order: string[] = []
    server.remote.pushCards.mockImplementationOnce(async (rows: ManualCardRow[]) => {
      order.push('cartes')
      for (const r of rows) server.putCard({ ...r, source: 'manual', deck: null, source_path: null, source_title: null })
    })
    const push = server.remote.pushReviews.getMockImplementation() as Remote['pushReviews']
    server.remote.pushReviews.mockImplementationOnce(async rows => { order.push('reviews'); await push(rows) })

    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    await db.reviews.add(review('r1', card.id))
    expect(await pendingCount(db)).toBe(2)

    const res = await sync(db, server.remote)

    expect(order).toEqual(['cartes', 'reviews'])
    expect(res.pushed).toBe(2)
    expect(server.cards.get(card.id)).toMatchObject({ source: 'manual', front: 'Q', back: 'R', tags: ['ia'], deck: null, source_path: null })
    expect(server.reviews.get('r1')).toMatchObject({ card_id: card.id })
    expect(await pendingCount(db)).toBe(0)
    // Le pull ramène la version serveur (horodatage serveur), marquée à jour.
    const local = (await db.cards.get(card.id))!
    expect(local.updated_at).toBe(server.cards.get(card.id)!.updated_at)
    expect(local.synced).not.toBe(0)
  })

  it('envoi des cartes en échec : la review de la carte attend (aucune review à envoyer), puis carte → review au sync suivant', async () => {
    const server = fakeServer()
    server.enforceFk = true
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    await db.reviews.add(review('r1', card.id))
    server.failCardPush = 'before'

    await expect(sync(db, server.remote)).rejects.toThrow('réseau coupé (cartes)')
    expect(server.remote.pushReviews).not.toHaveBeenCalled()
    expect(await pendingCount(db)).toBe(2)
    expect((await db.cards.get(card.id))!.synced).toBe(0) // le pull n'écrase pas une carte locale pas encore envoyée

    server.failCardPush = null
    await sync(db, server.remote)
    expect(server.cards.has(card.id)).toBe(true)
    expect(server.reviews.has('r1')).toBe(true)
    expect(await pendingCount(db)).toBe(0)
  })

  it('carte refusée durablement par la base : les reviews des autres cartes partent quand même, la sienne attend ; sync en échec', async () => {
    const server = fakeServer()
    server.enforceFk = true
    server.putCard({ id: 'v' })
    await db.cards.add({ ...server.cards.get('v')! })
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    await db.reviews.bulkAdd([review('r-manuelle', card.id), review('r-vault', 'v')])
    server.remote.pushCards.mockRejectedValue(new Error('invalid byte sequence'))

    for (let i = 0; i < 2; i++) await expect(sync(db, server.remote)).rejects.toThrow('invalid byte sequence')

    expect([...server.reviews.keys()]).toEqual(['r-vault'])
    expect((await db.reviews.get('r-vault'))!.synced).toBe(1)
    expect((await db.reviews.get('r-manuelle'))!.synced).toBe(0)
    expect(await pendingCount(db)).toBe(2) // la carte et sa review restent à envoyer (badge « Non synchronisé »)
  })

  it('une review sur une carte encore à envoyer n’est pas dans la file des reviews (même créée pendant l’envoi des cartes)', async () => {
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    await db.cards.add({ id: 'v', source: 'vault', deck: 'd', source_path: 'd/v.md', tags: [], front: 'Q', back: 'R', updated_at: 't', deleted_at: null })
    await db.reviews.bulkAdd([review('r1', card.id), review('r2', 'v')])
    expect((await reviewsOutbox.pending(db)).map(r => r.id)).toEqual(['r2'])
    expect(await reviewsOutbox.count(db)).toBe(2) // l'indicateur compte tout ce qui attend
    expect((await cardsOutbox.pending(db)).map(c => c.id)).toEqual([card.id])
  })

  it('envoi rejoué après une réponse perdue : une seule carte côté serveur, contenu à jour, plus rien à envoyer', async () => {
    const server = fakeServer()
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    server.failCardPush = 'after'
    server.remote.pullCards.mockRejectedValueOnce(new Error('hors ligne'))

    await expect(sync(db, server.remote)).rejects.toThrow('délai dépassé (cartes)')
    expect((await db.cards.get(card.id))!.synced).toBe(0)

    await sync(db, server.remote)
    expect(server.remote.pushCards).toHaveBeenCalledTimes(2)
    expect([...server.cards.keys()]).toEqual([card.id])
    expect(server.cards.get(card.id)).toMatchObject({ front: 'Q', source: 'manual' })
    expect(await pendingCount(db)).toBe(0)
  })

  it('édition puis suppression douce : chacune repart au serveur ; la carte supprimée sort de la file', async () => {
    const server = fakeServer()
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    await sync(db, server.remote)

    await updateCard(db, card.id, { front: 'Q2', tags: ['dev', 'ia'] })
    expect(await pendingCount(db)).toBe(1)
    await sync(db, server.remote)
    expect(server.cards.get(card.id)).toMatchObject({ front: 'Q2', back: 'R', tags: ['dev', 'ia'], deleted_at: null })

    await deleteManualCard(db, card.id, { now: () => NOW })
    await sync(db, server.remote)
    expect(server.cards.get(card.id)!.deleted_at).toBe(NOW.toISOString())
    expect(await pendingCount(db)).toBe(0)
    expect(buildQueue(await db.cards.toArray(), [], NOW)).toEqual([])
  })

  it('carte modifiée pendant son envoi : la nouvelle version reste à envoyer et part au sync suivant', async () => {
    const server = fakeServer()
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    const push = server.remote.pushCards.getMockImplementation() as Remote['pushCards']
    server.remote.pushCards.mockImplementationOnce(async (rows: ManualCardRow[]) => {
      await updateCard(db, card.id, { back: 'R2' }) // l'utilisateur édite pendant que l'envoi est en vol
      await push(rows)
    })

    await sync(db, server.remote)
    expect(server.cards.get(card.id)!.back).toBe('R')
    expect((await db.cards.get(card.id))!).toMatchObject({ back: 'R2', synced: 0 })

    await sync(db, server.remote)
    expect(server.cards.get(card.id)!.back).toBe('R2')
    expect(await pendingCount(db)).toBe(0)
  })

  it('pull : une carte manuelle créée sur un autre appareil arrive (source manual) et entre dans la session', async () => {
    const server = fakeServer()
    server.putCard({ id: 'm', source: 'manual', deck: null, source_path: null, source_title: null, tags: ['culture'], front: 'Q', back: 'R' })

    const res = await sync(db, server.remote)

    expect(res.pulledCards).toBe(1)
    const local = (await db.cards.get('m'))!
    expect(local).toMatchObject({ source: 'manual', deck: null, source_path: null, tags: ['culture'] })
    expect(local.synced).toBeUndefined()
    expect(await pendingCount(db)).toBe(0)
    expect(buildQueue(await db.cards.toArray(), [], NOW).map(i => i.card.id)).toEqual(['m'])
  })

  it('pull : une édition locale pas encore envoyée n’est pas écrasée par la version serveur (envoi en échec)', async () => {
    const server = fakeServer()
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    await sync(db, server.remote)
    await updateCard(db, card.id, { front: 'locale' })
    server.putCard({ id: card.id, front: 'autre appareil' }) // modifiée ailleurs entre-temps
    server.failCardPush = 'before'

    await expect(sync(db, server.remote)).rejects.toThrow('réseau coupé (cartes)')
    expect((await db.cards.get(card.id))!).toMatchObject({ front: 'locale', synced: 0 })

    server.failCardPush = null
    await sync(db, server.remote) // la dernière écriture envoyée l'emporte
    expect(server.cards.get(card.id)!.front).toBe('locale')
    expect((await db.cards.get(card.id))!.front).toBe('locale')
  })
})

describe('sync : brouillons de la boîte de réception (#55)', () => {
  const NOW = new Date('2026-10-15T10:00:00.000Z')
  const serverDraft = (server: ReturnType<typeof fakeServer>, id: string) =>
    server.putCard({ id, source: 'inbox', status: 'draft', inbox_id: 'i1', deck: null, source_path: null, source_title: 'Doc', tags: ['ia'] })

  it('pull : un brouillon arrive (status, inbox_id) mais reste hors session', async () => {
    const server = fakeServer()
    serverDraft(server, 'd')
    await sync(db, server.remote)
    expect(await db.cards.get('d')).toMatchObject({ source: 'inbox', status: 'draft', inbox_id: 'i1' })
    expect(buildQueue(await db.cards.toArray(), [], NOW)).toHaveLength(0)
  })

  it('accepté puis noté : la carte (status active) part avant sa review, puis tout est à jour', async () => {
    const server = fakeServer()
    server.enforceFk = true
    serverDraft(server, 'd')
    serverDraft(server, 'r')
    await sync(db, server.remote)
    const order: string[] = []
    const pushCards = server.remote.pushCards.getMockImplementation() as Remote['pushCards']
    server.remote.pushCards.mockImplementationOnce(async rows => { order.push('cartes'); await pushCards(rows) })
    const pushReviews = server.remote.pushReviews.getMockImplementation() as Remote['pushReviews']
    server.remote.pushReviews.mockImplementationOnce(async rows => { order.push('reviews'); await pushReviews(rows) })

    await acceptDraft(db, 'd', { front: 'Q corrigée' }, { now: () => NOW })
    await rejectDraft(db, 'r', { now: () => NOW })
    await db.reviews.add(review('r1', 'd'))
    const res = await sync(db, server.remote)

    expect(order).toEqual(['cartes', 'reviews'])
    expect(res.pushed).toBe(3)
    expect(server.remote.pushCards).toHaveBeenLastCalledWith(expect.arrayContaining([
      { id: 'd', source: 'inbox', status: 'active', front: 'Q corrigée', back: 'd', tags: ['ia'], deleted_at: null },
      { id: 'r', source: 'inbox', front: 'r', back: 'r', tags: ['ia'], deleted_at: NOW.toISOString() },
    ]))
    expect(await pendingCount(db)).toBe(0)
    expect(await db.cards.get('d')).toMatchObject({ status: 'active', front: 'Q corrigée' })
  })

  it('brouillon accepté localement : le pull de la version serveur (encore draft) ne l’écrase pas avant l’envoi', async () => {
    const server = fakeServer()
    serverDraft(server, 'd')
    await sync(db, server.remote)
    await acceptDraft(db, 'd', undefined, { now: () => NOW })
    server.failCardPush = 'before'
    serverDraft(server, 'd') // nouvelle version serveur, toujours brouillon
    await expect(sync(db, server.remote)).rejects.toThrow(SyncError)
    expect((await db.cards.get('d'))!.status).toBe('active')
  })
})

describe('sync : brouillon sur deux appareils (#55)', () => {
  const NOW = new Date('2026-10-15T10:00:00.000Z')
  let other: VaultDB
  beforeEach(() => { other = new VaultDB('test-' + crypto.randomUUID()) })
  afterEach(async () => { await other.delete() })

  async function acceptedOnA() {
    const server = fakeServer()
    server.putCard({ id: 'd', source: 'inbox', status: 'draft', inbox_id: 'i1', deck: null, source_path: null, tags: ['ia'] })
    await sync(db, server.remote)
    await sync(other, server.remote) // B voit encore le brouillon
    await acceptDraft(db, 'd', undefined, { now: () => NOW })
    await sync(db, server.remote) // A : serveur en active
    return server
  }

  it('accepté sur A, retouché sur B : B n’envoie pas status, le serveur reste active avec la retouche ; rien de bloqué', async () => {
    const server = await acceptedOnA()
    await updateDraft(other, 'd', { front: 'Retouchée sur B' }, { now: () => NOW })
    const manual = await createManualCard(other, { front: 'M', back: 'R', tags: ['ia'] })
    await sync(other, server.remote)
    expect(await pendingCount(other)).toBe(0)
    expect(server.cards.get('d')).toMatchObject({ status: 'active', front: 'Retouchée sur B' })
    expect(server.cards.get(manual.id)).toMatchObject({ source: 'manual' })
    expect(await other.cards.get('d')).toMatchObject({ status: 'active', front: 'Retouchée sur B' })
  })

  it('accepté sur A, rejeté sur B : la suppression douce part (dernier mot à B), aucune erreur', async () => {
    const server = await acceptedOnA()
    await rejectDraft(other, 'd', { now: () => NOW })
    await sync(other, server.remote)
    expect(await pendingCount(other)).toBe(0)
    expect(server.cards.get('d')).toMatchObject({ status: 'active', deleted_at: NOW.toISOString() })
  })

  it('conflit 23514 (stale) : carte marquée envoyée, pull complet qui reprend l’état serveur ; les autres cartes partent', async () => {
    const server = await acceptedOnA()
    // B garde une version locale « draft » à envoyer (cache d'avant #55 fix, ou autre client) : le serveur la refuse (23514).
    await other.cards.update('d', { front: 'B', synced: 0 })
    server.remote.pushCards.mockImplementationOnce(async (rows: ManualCardRow[]) => {
      for (const r of rows.filter(r => r.id !== 'd')) server.putCard({ ...r, source: 'manual', deck: null, source_path: null, source_title: null })
      return { stale: ['d'] }
    })
    const manual = await createManualCard(other, { front: 'M', back: 'R', tags: ['ia'] })
    await sync(other, server.remote)
    expect(await pendingCount(other)).toBe(0)
    expect(server.cards.has(manual.id)).toBe(true)
    expect(await other.cards.get('d')).toMatchObject({ status: 'active', front: 'd' }) // version serveur reprise
  })

  it('échec isolé : une carte refusée reste à envoyer, les autres sont marquées ; le sync signale l’échec', async () => {
    const server = await acceptedOnA()
    await updateDraft(other, 'd', { front: 'B' }, { now: () => NOW })
    const manual = await createManualCard(other, { front: 'M', back: 'R', tags: ['ia'] })
    server.remote.pushCards.mockImplementationOnce(async (rows: ManualCardRow[]) => {
      for (const r of rows.filter(r => r.id !== 'd')) server.putCard({ ...r, source: 'manual', deck: null, source_path: null, source_title: null })
      return { failed: [{ id: 'd', error: new Error('refus durable') }] }
    })
    await expect(sync(other, server.remote)).rejects.toThrow('refus durable')
    expect((await other.cards.get(manual.id))!.synced).not.toBe(0) // partie (puis relue du serveur)
    expect((await other.cards.get('d'))!.synced).toBe(0)
  })
})

describe('sync : tags libres (#79)', () => {
  const opts = (id: string) => ({ uuid: () => id, now: () => new Date('2026-10-21T10:00:00Z') })

  it('tag créé hors ligne sur une carte manuelle : part avec la carte, créé côté serveur, puis tiré dans db.tags', async () => {
    const server = fakeServer()
    await createManualCard(db, { front: 'Q', back: 'R', tags: ['  Chimie   organique '] }, opts('m1'))
    expect((await db.cards.get('m1'))!.tags).toEqual(['Chimie organique'])
    const res = await sync(db, server.remote)
    expect([...server.tags.values()].map(t => t.name)).toEqual(['Chimie organique'])
    expect((await db.tags.toArray()).map(t => t.name)).toEqual(['Chimie organique'])
    expect(res.pulledTags).toBe(1)
    // Idempotent : un second sync ne retire ni ne recompte rien.
    expect((await sync(db, server.remote)).pulledTags).toBe(0)
    expect(await db.tags.count()).toBe(1)
  })

  it('même nom créé hors ligne sur deux appareils (casse différente) : un seul tag, orthographe du premier reprise', async () => {
    const server = fakeServer()
    const other = new VaultDB('test-b-' + crypto.randomUUID())
    try {
      await createManualCard(db, { front: 'Q1', back: 'R', tags: ['Cerveau'] }, opts('m1'))
      await createManualCard(other, { front: 'Q2', back: 'R', tags: ['cerveau'] }, opts('m2'))
      await sync(db, server.remote)
      await sync(other, server.remote)
      await sync(db, server.remote)
      expect([...server.tags.values()].map(t => t.name)).toEqual(['Cerveau'])
      expect(server.cards.get('m2')!.tags).toEqual(['Cerveau'])
      for (const d of [db, other]) {
        expect((await d.tags.toArray()).map(t => t.name)).toEqual(['Cerveau'])
        expect((await d.cards.get('m2'))!.tags).toEqual(['Cerveau'])
      }
    } finally {
      await other.delete()
    }
  })

  it('carte du vault modifiée dans l’app (#73) : UPDATE seul, nouveaux tags créés, plus rien en attente', async () => {
    const server = fakeServer()
    server.putCard({ id: 'v1', tags: ['IA & agents'] })
    await sync(db, server.remote)
    await updateCard(db, 'v1', { front: 'Nouvelle question', tags: ['IA & agents', 'Mémoire'] })
    await sync(db, server.remote)
    expect(server.remote.pushCards).toHaveBeenLastCalledWith([
      { id: 'v1', source: 'vault', front: 'Nouvelle question', back: 'v1', tags: ['IA & agents', 'Mémoire'], deleted_at: null },
    ])
    expect(server.cards.get('v1')).toMatchObject({ source: 'vault', front: 'Nouvelle question', tags: ['IA & agents', 'Mémoire'] })
    expect([...server.tags.values()].map(t => t.name).sort()).toEqual(['IA & agents', 'Mémoire'])
    expect(await pendingCount(db)).toBe(0)
  })

  it('brouillon : un nouveau tag proposé n’est créé qu’à la validation, jamais s’il est retiré avant', async () => {
    const server = fakeServer()
    const draft = { source: 'inbox' as const, status: 'draft' as const, inbox_id: 'i1', deck: null, source_path: null }
    server.putCard({ id: 'd1', ...draft, tags: ['Nouveau A', 'Culture'] })
    server.putCard({ id: 'd2', ...draft, tags: ['Nouveau B', 'Culture'] })
    await sync(db, server.remote)
    expect(server.tags.size).toBe(0)
    await updateDraft(db, 'd1', { tags: ['Nouveau A', 'Culture', 'Nouveau C'] })
    await sync(db, server.remote)
    expect(server.tags.size).toBe(0)
    await acceptDraft(db, 'd1')
    await acceptDraft(db, 'd2', { tags: ['Culture'] }) // « Nouveau B » retiré avant de valider
    await sync(db, server.remote)
    expect([...server.tags.values()].map(t => t.name).sort()).toEqual(['Culture', 'Nouveau A', 'Nouveau C'])
    expect((await db.tags.toArray()).map(t => t.name).sort()).toEqual(['Culture', 'Nouveau A', 'Nouveau C'])
  })
})
