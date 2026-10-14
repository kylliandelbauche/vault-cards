import type { VaultDB } from './db'
import type { supabase } from './supabase'
import type { Card, CardSource, Rating, Review } from './types'

/** Colonnes d'une review côté serveur (`synced` et `free` sont locaux). */
type ReviewRow = Pick<Review, 'id' | 'card_id' | 'rating' | 'reviewed_at'>
type ServerReview = ReviewRow & { inserted_at: string }

/**
 * Colonnes qu'envoie l'app pour une carte manuelle (#54) : exactement celles que le rôle authenticated peut écrire
 * (migration 20261015000000_manual_cards). `source = 'manual'` est ajouté à l'insertion ; deck, source_path,
 * source_title et les horodatages restent au serveur.
 */
export type ManualCardRow = Pick<Card, 'id' | 'front' | 'back' | 'tags' | 'deleted_at'>

/**
 * Position dans un pull : dernière ligne reçue, dans l'ordre (horodatage serveur, id).
 * Une écriture en lot partage le même now() : l'id départage les égalités.
 */
export interface Cursor { at: string; id: string }

export interface Remote {
  /** Crée ou met à jour des cartes manuelles ; idempotent (un envoi rejoué réécrit le même contenu). */
  pushCards(rows: ManualCardRow[]): Promise<void>
  pushReviews(rows: ReviewRow[]): Promise<void>
  /** Au plus `limit` cartes strictement après `after` dans l'ordre (updated_at, id), triées dans cet ordre. */
  pullCards(after: Cursor | null, limit: number): Promise<Card[]>
  /** Au plus `limit` reviews strictement après `after` dans l'ordre (inserted_at, id), triées dans cet ordre. */
  pullReviews(after: Cursor | null, limit: number): Promise<ServerReview[]>
}

/**
 * Taille de page des pulls. Une page plus courte signifie « fin des données » : elle ne doit
 * donc pas dépasser `max_rows` de l'API Supabase (1000 par défaut). Si elle le dépassait, le pull
 * s'arrêterait simplement plus tôt et reprendrait du curseur au sync suivant.
 */
export const PAGE = 1000

/**
 * Filtre « après le curseur » (pagination par clé, keyset) : `col > at` OU (`col = at` ET `id > lastId`).
 * Contrairement à un décalage `.range()`, une ligne modifiée pendant le pull ne décale pas les suivantes :
 * elle repasse simplement en fin d'ordre, aucune n'est sautée. Valeurs entre guillemets (syntaxe PostgREST) :
 * l'horodatage contient `:` et `.`, réservés dans un filtre `or`.
 */
export const after = (col: string, c: Cursor) => `${col}.gt."${c.at}",and(${col}.eq."${c.at}",id.gt."${c.id}")`

type Page<T> = { data: T[] | null; error: { message: string } | null }
const rowsOf = <T>({ data, error }: Page<T>) => {
  if (error) throw new Error(error.message)
  return data ?? []
}

export const supabaseRemote = (client: typeof supabase): Remote => ({
  async pushCards(rows) {
    if (!rows.length) return
    // 1. INSERT … ON CONFLICT (id) DO NOTHING en un appel : la réponse ne contient que les lignes vraiment insérées.
    //    Pas d'upsert « merge » : il mettrait aussi à jour id et source, colonnes que authenticated ne peut pas modifier.
    const { data, error } = await client
      .from('cards')
      .upsert(rows.map(r => ({ ...r, source: 'manual' })), { onConflict: 'id', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(error.message)
    const inserted = new Set((data ?? []).map(r => r.id))
    // 2. Cartes déjà présentes (édition, suppression douce, ou envoi rejoué) : UPDATE des seules colonnes autorisées.
    //    0 ligne = carte invisible pour la policy (carte vault, ou supprimée côté serveur) : erreur, la carte reste à envoyer.
    for (const { id, front, back, tags, deleted_at } of rows.filter(r => !inserted.has(r.id))) {
      const res = await client.from('cards').update({ front, back, tags, deleted_at }).eq('id', id).eq('source', 'manual').select('id')
      if (res.error) throw new Error(res.error.message)
      if (!res.data?.length) throw new Error(`carte ${id} : aucune ligne modifiée`)
    }
  },

  async pushReviews(rows) {
    // INSERT … ON CONFLICT (id) DO NOTHING : un push rejoué ne crée pas de doublon,
    // et ne tente jamais d'UPDATE (le rôle authenticated n'a que select + insert sur reviews).
    const { error } = await client.from('reviews').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  },

  async pullCards(cursor, limit) {
    let q = client.from('cards').select('id, source, deck, source_path, source_title, tags, front, back, updated_at, deleted_at')
    if (cursor) q = q.or(after('updated_at', cursor))
    const rows = rowsOf(await q.order('updated_at').order('id').limit(limit))
    return rows.map(c => ({ ...c, source: c.source as CardSource })) // contrainte SQL : 'vault' ou 'manual'
  },

  async pullReviews(cursor, limit) {
    let q = client.from('reviews').select('id, card_id, rating, reviewed_at, inserted_at')
    if (cursor) q = q.or(after('inserted_at', cursor))
    const rows = rowsOf(await q.order('inserted_at').order('id').limit(limit))
    return rows.map(r => ({ ...r, rating: r.rating as Rating })) // contrainte SQL : rating entre 1 et 3
  },
})

const CURSOR_CARDS = 'cursor:cards'
const CURSOR_REVIEWS = 'cursor:reviews'

/**
 * Curseur composite stocké en JSON dans `meta`. Ancien format (horodatage seul, avant #22) ou valeur
 * illisible : null, donc un pull complet une fois (idempotent) qui rattrape aussi une ligne qu'aurait
 * sautée l'ancienne pagination par décalage.
 */
export function parseCursor(value: string | undefined): Cursor | null {
  if (!value) return null
  try {
    const c: unknown = JSON.parse(value)
    if (c && typeof c === 'object' && 'at' in c && 'id' in c && typeof c.at === 'string' && typeof c.id === 'string') {
      return { at: c.at, id: c.id }
    }
  } catch {
    // Ancien format : un horodatage n'est pas du JSON.
  }
  return null
}

/**
 * Tire toutes les pages après le curseur `key`. Chaque page est écrite avec son curseur dans une même
 * transaction : un pull interrompu (réseau) garde les pages déjà reçues et reprend juste après ;
 * une page en échec ne déplace pas le curseur. `onRows` renvoie le nombre de lignes réellement nouvelles.
 */
async function pullAll<T extends { id: string }>(
  db: VaultDB,
  key: string,
  table: VaultDB['cards'] | VaultDB['reviews'],
  fetch: (after: Cursor | null, limit: number) => Promise<T[]>,
  stamp: (row: T) => string,
  onRows: (rows: T[]) => Promise<number>,
  pageSize: number,
  count: (n: number) => void,
) {
  let cursor = parseCursor((await db.meta.get(key))?.value)
  for (;;) {
    const rows = await fetch(cursor, pageSize)
    if (rows.length) {
      const last = rows[rows.length - 1]
      const next: Cursor = { at: stamp(last), id: last.id }
      // Anti-boucle : un serveur qui ignorerait le filtre renverrait sans fin la même page pleine.
      if (cursor && next.at === cursor.at && next.id === cursor.id) return
      await db.transaction('rw', table, db.meta, async () => {
        count(await onRows(rows))
        await db.meta.put({ key, value: JSON.stringify(next) })
      })
      cursor = next
    }
    if (rows.length < pageSize) return
  }
}

/**
 * Les reviews sont immuables côté serveur (insert seul) : une review déjà connue localement n'est pas réécrite
 * (les champs locaux restent), elle est seulement marquée `synced: 1` si son push n'avait pas été confirmé.
 * Renvoie le nombre de reviews vraiment nouvelles (d'un autre appareil) : relire les nôtres n'est pas un changement.
 */
async function mergeReviews(db: VaultDB, rows: ServerReview[]) {
  const known = await db.reviews.bulkGet(rows.map(r => r.id))
  const fresh = rows.filter((_, i) => !known[i])
  const confirmed = known.filter(r => r?.synced === 0).map(r => ({ key: r!.id, changes: { synced: 1 as const } }))
  await db.reviews.bulkAdd(fresh.map(({ id, card_id, rating, reviewed_at }) => ({ id, card_id, rating, reviewed_at, synced: 1 as const })))
  if (confirmed.length) await db.reviews.bulkUpdate(confirmed)
  return fresh.length
}

/**
 * Cartes tirées du serveur. Une carte manuelle modifiée sur cet appareil et pas encore envoyée (`synced: 0`)
 * n'est pas écrasée : elle part au prochain envoi (la dernière écriture envoyée l'emporte), puis revient du serveur.
 */
async function mergeCards(db: VaultDB, rows: Card[]) {
  const local = await db.cards.bulkGet(rows.map(c => c.id))
  const fresh = rows.filter((_, i) => local[i]?.synced !== 0)
  await db.cards.bulkPut(fresh)
  return fresh.length
}

/**
 * File d'envoi : des lignes locales en attente, envoyées au serveur puis marquées comme parties.
 * `pending` est un instantané : une ligne ajoutée pendant l'envoi n'est pas marquée et part au sync suivant.
 * L'envoi doit être idempotent (INSERT … ON CONFLICT DO NOTHING) : une réponse perdue fait renvoyer les mêmes lignes.
 */
export interface Outbox<Row> {
  /** Nombre de lignes en attente (indicateur de synchro, déconnexion sûre). */
  count(db: VaultDB): Promise<number>
  pending(db: VaultDB): Promise<Row[]>
  send(remote: Remote, rows: Row[]): Promise<void>
  markSent(db: VaultDB, rows: Row[]): Promise<void>
}

/** File typée réduite à ce dont `sync` a besoin, pour ranger des files de lignes différentes dans une même liste. */
export interface OutboxQueue {
  count(db: VaultDB): Promise<number>
  /** Envoie les lignes en attente ; renvoie leur nombre. Rejette sans rien marquer si l'envoi échoue. */
  push(db: VaultDB, remote: Remote): Promise<number>
}

export const outboxQueue = <Row>(o: Outbox<Row>): OutboxQueue => ({
  count: db => o.count(db),
  async push(db, remote) {
    const rows = await o.pending(db)
    if (!rows.length) return 0
    await o.send(remote, rows)
    await o.markSent(db, rows)
    return rows.length
  },
})

const sameContent = (a: ManualCardRow, b: ManualCardRow) =>
  a.front === b.front && a.back === b.back && a.deleted_at === b.deleted_at
  && a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i])

/** Cartes manuelles créées, modifiées ou supprimées (douce) sur cet appareil (`synced: 0`, #54). */
export const cardsOutbox: Outbox<Card> = {
  count: db => db.cards.where('synced').equals(0).count(),
  pending: db => db.cards.where('synced').equals(0).toArray(),
  send: (remote, rows) => remote.pushCards(rows.map(({ id, front, back, tags, deleted_at }) => ({ id, front, back, tags, deleted_at }))),
  // Une carte modifiée pendant l'envoi garde `synced: 0` : seule une carte encore identique à ce qui est parti est marquée.
  markSent: (db, rows) => db.transaction('rw', db.cards, async () => {
    const current = await db.cards.bulkGet(rows.map(r => r.id))
    const sent = rows.filter((r, i) => current[i]?.synced === 0 && sameContent(current[i]!, r))
    await db.cards.bulkUpdate(sent.map(r => ({ key: r.id, changes: { synced: 1 as const } })))
  }),
}

/**
 * Reviews notées sur cet appareil (`synced: 0`). Une review dont la carte manuelle n'est pas encore envoyée attend
 * (clé étrangère reviews.card_id) : elle part au sync qui suit l'envoi de sa carte. Elle compte quand même dans `count`.
 */
export const reviewsOutbox: Outbox<Review> = {
  count: db => db.reviews.where('synced').equals(0).count(),
  pending: async db => {
    const waiting = new Set(await db.cards.where('synced').equals(0).primaryKeys())
    const rows = await db.reviews.where('synced').equals(0).toArray()
    return rows.filter(r => !waiting.has(r.card_id))
  },
  send: (remote, rows) => remote.pushReviews(rows.map(({ id, card_id, rating, reviewed_at }) => ({ id, card_id, rating, reviewed_at }))),
  markSent: (db, rows) => db.reviews.bulkUpdate(rows.map(r => ({ key: r.id, changes: { synced: 1 as const } }))).then(() => {}),
}

/**
 * Files envoyées à chaque sync, dans cet ordre : les cartes créées sur l'appareil (#54) avant les reviews (clé étrangère
 * reviews.card_id). Chaque file est tentée même si une précédente a échoué : une carte refusée durablement ne bloque pas
 * les reviews des autres cartes. La dépendance est tenue par reviewsOutbox.pending, qui écarte les reviews d'une carte
 * pas encore envoyée. Une file en échec fait échouer le sync (badge « Non synchronisé ») ; le pull a lieu quand même.
 */
export const OUTBOX: readonly OutboxQueue[] = [outboxQueue(cardsOutbox), outboxQueue(reviewsOutbox)]

export interface SyncResult { pushed: number; pulledCards: number; pulledReviews: number }

/**
 * Sync incomplet : le push ou le pull a échoué. `result` dit ce qui a quand même été fait
 * (des cartes tirées malgré un push en échec doivent recharger une session vide).
 */
export class SyncError extends Error {
  readonly result: SyncResult
  readonly causes: unknown[]
  constructor(result: SyncResult, causes: unknown[]) {
    super(causes.map(e => (e instanceof Error ? e.message : String(e))).join(' ; '))
    this.name = 'SyncError'
    this.result = result
    this.causes = causes
  }
}

export interface SyncOptions {
  /** Taille de page des pulls (réduite en test). */
  pageSize?: number
  /** Files d'envoi (OUTBOX par défaut). */
  outbox?: readonly OutboxQueue[]
}

/**
 * Pousse les files d'envoi, puis tire cartes et reviews modifiées après les curseurs (pagination par clé
 * (horodatage serveur, id) : ni ligne sautée, ni ligne relue). Push et pull sont indépendants : le pull a lieu
 * même si le push échoue (les lignes non envoyées restent en attente et repartent au prochain sync).
 * Rejette avec SyncError si l'un des deux a échoué, après avoir tenté les deux.
 */
export async function sync(db: VaultDB, remote: Remote, { pageSize = PAGE, outbox = OUTBOX }: SyncOptions = {}): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulledCards: 0, pulledReviews: 0 }
  const errors: unknown[] = []
  for (const queue of outbox) {
    try {
      result.pushed += await queue.push(db, remote)
    } catch (e) {
      errors.push(e)
    }
  }
  try {
    await pullAll(db, CURSOR_CARDS, db.cards, (a, n) => remote.pullCards(a, n), c => c.updated_at,
      cards => mergeCards(db, cards),
      pageSize, n => { result.pulledCards += n })
    await pullAll(db, CURSOR_REVIEWS, db.reviews, (a, n) => remote.pullReviews(a, n), r => r.inserted_at,
      reviews => mergeReviews(db, reviews),
      pageSize, n => { result.pulledReviews += n })
  } catch (e) {
    errors.push(e)
  }
  if (errors.length) throw new SyncError(result, errors)
  return result
}

/** Lignes locales pas encore envoyées, toutes files confondues. */
export const pendingCount = async (db: VaultDB, outbox: readonly OutboxQueue[] = OUTBOX) => {
  let n = 0
  for (const queue of outbox) n += await queue.count(db)
  return n
}
