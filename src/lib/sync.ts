import type { VaultDB } from './db'
import type { supabase } from './supabase'
import type { Card, Rating, Review } from './types'

type ServerReview = Omit<Review, 'synced'> & { inserted_at: string }

export interface Remote {
  pushReviews(rows: Omit<Review, 'synced'>[]): Promise<void>
  pullCards(since: string | null): Promise<Card[]>
  pullReviews(since: string | null): Promise<ServerReview[]>
}

/**
 * Taille de page des pulls. Une page plus courte signifie « fin des données » : elle ne doit
 * donc pas dépasser `max_rows` de l'API Supabase (1000 par défaut).
 */
const PAGE = 1000

/** Lit toutes les pages d'une requête triée de façon stable (horodatage puis id). */
async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

export const supabaseRemote = (client: typeof supabase): Remote => ({
  async pushReviews(rows) {
    // INSERT … ON CONFLICT (id) DO NOTHING : un push rejoué ne crée pas de doublon,
    // et ne tente jamais d'UPDATE (le rôle authenticated n'a que select + insert sur reviews).
    const { error } = await client.from('reviews').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  },

  pullCards: since => allPages((from, to) => {
    let q = client.from('cards').select('id, deck, source_path, tags, front, back, updated_at, deleted_at')
    if (since) q = q.gte('updated_at', since)
    // Une écriture en lot partage le même now() : l'id départage, sinon .range() n'est pas stable.
    return q.order('updated_at').order('id').range(from, to)
  }),

  pullReviews: async since => {
    const rows = await allPages((from, to) => {
      let q = client.from('reviews').select('id, card_id, rating, reviewed_at, inserted_at')
      if (since) q = q.gte('inserted_at', since)
      return q.order('inserted_at').order('id').range(from, to)
    })
    return rows.map(r => ({ ...r, rating: r.rating as Rating })) // contrainte SQL : rating entre 1 et 3
  },
})

const CURSOR_CARDS = 'cursor:cards'
const CURSOR_REVIEWS = 'cursor:reviews'

async function getCursor(db: VaultDB, key: string) {
  return (await db.meta.get(key))?.value ?? null
}

/**
 * Plus grand horodatage serveur. Comparaison de chaînes : PostgREST renvoie toujours le même
 * format (ISO, décalage +00:00), et elle garde les microsecondes que Date perdrait.
 */
const maxOf = (values: string[], current: string | null) =>
  values.reduce<string | null>((m, v) => (m === null || v > m ? v : m), current)

/**
 * Pousse les reviews locales en attente, puis tire cartes et reviews modifiées depuis les curseurs.
 * Les curseurs sont des horodatages serveur ; le pull utilise `>=` et `bulkPut` est idempotent,
 * donc une ligne au même horodatage que le curseur n'est jamais perdue (elle est seulement relue).
 */
export async function sync(db: VaultDB, remote: Remote) {
  const pending = await db.reviews.where('synced').equals(0).toArray()
  if (pending.length) {
    await remote.pushReviews(pending.map(({ id, card_id, rating, reviewed_at }) => ({ id, card_id, rating, reviewed_at })))
    await db.reviews.bulkUpdate(pending.map(r => ({ key: r.id, changes: { synced: 1 as const } })))
  }

  const cards = await remote.pullCards(await getCursor(db, CURSOR_CARDS))
  if (cards.length) {
    await db.transaction('rw', db.cards, db.meta, async () => {
      await db.cards.bulkPut(cards)
      await db.meta.put({ key: CURSOR_CARDS, value: maxOf(cards.map(c => c.updated_at), await getCursor(db, CURSOR_CARDS))! })
    })
  }

  const reviews = await remote.pullReviews(await getCursor(db, CURSOR_REVIEWS))
  if (reviews.length) {
    await db.transaction('rw', db.reviews, db.meta, async () => {
      await db.reviews.bulkPut(reviews.map(({ id, card_id, rating, reviewed_at }) => ({ id, card_id, rating, reviewed_at, synced: 1 as const })))
      await db.meta.put({ key: CURSOR_REVIEWS, value: maxOf(reviews.map(r => r.inserted_at), await getCursor(db, CURSOR_REVIEWS))! })
    })
  }

  return { pushed: pending.length, pulledCards: cards.length, pulledReviews: reviews.length }
}

export const pendingCount = (db: VaultDB) => db.reviews.where('synced').equals(0).count()
