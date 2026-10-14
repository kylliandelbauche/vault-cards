import type { VaultDB } from './db'
import type { supabase } from './supabase'
import type { Card, Rating, Review } from './types'

type ServerReview = Omit<Review, 'synced'> & { inserted_at: string }

/**
 * Position dans un pull : dernière ligne reçue, dans l'ordre (horodatage serveur, id).
 * Une écriture en lot partage le même now() : l'id départage les égalités.
 */
export interface Cursor { at: string; id: string }

export interface Remote {
  pushReviews(rows: Omit<Review, 'synced'>[]): Promise<void>
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
  async pushReviews(rows) {
    // INSERT … ON CONFLICT (id) DO NOTHING : un push rejoué ne crée pas de doublon,
    // et ne tente jamais d'UPDATE (le rôle authenticated n'a que select + insert sur reviews).
    const { error } = await client.from('reviews').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  },

  async pullCards(cursor, limit) {
    let q = client.from('cards').select('id, deck, source_path, source_title, tags, front, back, updated_at, deleted_at')
    if (cursor) q = q.or(after('updated_at', cursor))
    return rowsOf(await q.order('updated_at').order('id').limit(limit))
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
      await db.transaction('rw', table, db.meta, async () => {
        count(await onRows(rows))
        await db.meta.put({ key, value: JSON.stringify(next) })
      })
      cursor = next
    }
    if (rows.length < pageSize) return
  }
}

export interface SyncOptions {
  /** Taille de page des pulls (réduite en test). */
  pageSize?: number
}

/**
 * Pousse les reviews locales en attente, puis tire cartes et reviews modifiées après les curseurs
 * (pagination par clé (horodatage serveur, id) : ni ligne sautée, ni ligne relue).
 */
export async function sync(db: VaultDB, remote: Remote, { pageSize = PAGE }: SyncOptions = {}) {
  const pending = await db.reviews.where('synced').equals(0).toArray()
  if (pending.length) {
    await remote.pushReviews(pending.map(({ id, card_id, rating, reviewed_at }) => ({ id, card_id, rating, reviewed_at })))
    await db.reviews.bulkUpdate(pending.map(r => ({ key: r.id, changes: { synced: 1 as const } })))
  }

  const result = { pushed: pending.length, pulledCards: 0, pulledReviews: 0 }
  await pullAll(db, CURSOR_CARDS, db.cards, (a, n) => remote.pullCards(a, n), c => c.updated_at,
    async cards => { await db.cards.bulkPut(cards); return cards.length },
    pageSize, n => { result.pulledCards += n })
  await pullAll(db, CURSOR_REVIEWS, db.reviews, (a, n) => remote.pullReviews(a, n), r => r.inserted_at,
    async reviews => {
      await db.reviews.bulkPut(reviews.map(({ id, card_id, rating, reviewed_at }) => ({ id, card_id, rating, reviewed_at, synced: 1 as const })))
      return reviews.length
    },
    pageSize, n => { result.pulledReviews += n })
  return result
}

export const pendingCount = (db: VaultDB) => db.reviews.where('synced').equals(0).count()
