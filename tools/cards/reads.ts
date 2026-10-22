// Lectures complètes des cartes du vault (lecture seule), appelées par cli.ts. Séparées de cli.ts (qui s'exécute à
// l'import) pour pouvoir être testées avec un faux client. Toutes paginent par clé sur `id` (#70, #100) : voir readAllByKey.
// Cartes : uniquement source = 'vault' (vaultOnly), comme dans cli.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk, readAllByKey, sortCardsForOutput, vaultOnly, type TitledCard } from './lib.ts'

/** Chemins longs + emojis encodés : on reste loin de la limite de longueur d'URL. */
export const PATHS_PER_QUERY = 20

function fail(step: string, error: { message: string }): never {
  throw new Error(`${step} : ${error.message}`)
}

export interface AllCard { id: string; source_path: string; source_title: string | null; front: string; back: string; tags: string[] }

/** Toutes les cartes vivantes (lecture seule) : base de la procédure de re-tag. Ordre : source_path, created_at, id. */
export async function fetchAll(db: SupabaseClient): Promise<AllCard[]> {
  // L'ordre de sortie est rétabli en mémoire ; created_at sert au tri et ne fait pas partie de la sortie.
  const rows = await readAllByKey<AllCard & { created_at: string }>(async (after, limit) => {
    let query = vaultOnly(db.from('cards').select('id, source_path, source_title, front, back, tags, created_at')).is('deleted_at', null)
    if (after !== null) query = query.gt('id', after)
    const { data, error } = await query.order('id').limit(limit)
    if (error) fail('lecture des cartes', error)
    return data
  })
  return sortCardsForOutput(rows).map(c => ({ id: c.id, source_path: c.source_path, source_title: c.source_title, front: c.front, back: c.back, tags: c.tags }))
}

/** Un `source_path` par carte vivante des notes données. Paquets de chemins (URL courte) et pagination par clé. */
export async function fetchLiveCardPaths(db: SupabaseClient, paths: string[]): Promise<{ source_path: string }[]> {
  const rows: { source_path: string }[] = []
  for (const group of chunk(paths, PATHS_PER_QUERY)) {
    rows.push(...await readAllByKey<{ id: string; source_path: string }>(async (after, limit) => {
      let query = vaultOnly(db.from('cards').select('id, source_path')).in('source_path', group).is('deleted_at', null)
      if (after !== null) query = query.gt('id', after)
      const { data, error } = await query.order('id').limit(limit)
      if (error) fail('lecture des cartes', error)
      return data
    }))
  }
  return rows
}

/** Tags de toutes les cartes vivantes (commande `tags`). */
export async function fetchCardTags(db: SupabaseClient): Promise<{ id: string; tags: string[] }[]> {
  return readAllByKey<{ id: string; tags: string[] }>(async (after, limit) => {
    let query = vaultOnly(db.from('cards').select('id, tags')).is('deleted_at', null)
    if (after !== null) query = query.gt('id', after)
    const { data, error } = await query.order('id').limit(limit)
    if (error) fail('lecture des cartes', error)
    return data
  })
}

/** Cartes vivantes avec leur titre de source (commande `titles`). */
export async function fetchTitledCards(db: SupabaseClient): Promise<TitledCard[]> {
  return readAllByKey<TitledCard>(async (after, limit) => {
    let query = vaultOnly(db.from('cards').select('id, source_path, source_title')).is('deleted_at', null)
    if (after !== null) query = query.gt('id', after)
    const { data, error } = await query.order('id').limit(limit)
    if (error) fail('lecture des cartes', error)
    return data as TitledCard[]
  })
}
