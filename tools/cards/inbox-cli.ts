// Boîte de réception (#55), accès base et Storage de l'outil (clé secrète, appelé par cli.ts : `inbox …`).
// Cartes : uniquement source = 'inbox' (inboxOnly), insérées en brouillon. Les cartes vault et manual ne sont jamais
// lues ni modifiées ici (vérifié par inbox.test.ts). Le contenu des documents n'est jamais affiché : il est écrit
// dans le dossier de l'exécution (RUN_DIR) pour que l'agent le lise, et traité comme de la donnée.
import fs from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './lib.ts'
import { INBOX_SOURCE, STALE_MS, claimPath, fileProblem, shortError, validateInboxPayload, type InboxCommand } from './inbox.ts'

const BUCKET = 'inbox'

/** Restreint une requête sur la table des cartes aux cartes de la boîte de réception. Seule porte d'accès de ce fichier à la table. */
export function inboxOnly<Q>(query: Q): Q {
  return (query as Q & { eq(column: string, value: string): Q }).eq('source', INBOX_SOURCE)
}

function fail(step: string, error: { message: string }): never {
  throw new Error(`${step} : ${error.message}`)
}

interface Item { id: string; kind: 'text' | 'file'; status: string; text: string | null; storage_path: string | null; filename: string | null; mime: string | null; size: number | null }

async function getItem(db: SupabaseClient, id: string): Promise<Item> {
  const { data, error } = await db.from('inbox').select('id, kind, status, text, storage_path, filename, mime, size').eq('id', id)
  if (error) fail('lecture de l’élément', error)
  if (!data.length) throw new Error(`élément introuvable : ${id}`)
  return data[0] as Item
}

/** Supprime le fichier d'un élément ; renvoie true s'il a bien été supprimé (absent : false, sans erreur bloquante). */
async function removeFile(db: SupabaseClient, storagePath: string | null): Promise<boolean> {
  if (!storagePath) return false
  const { data, error } = await db.storage.from(BUCKET).remove([storagePath])
  return !error && (data ?? []).length === 1
}

/** Élément en erreur (message court), fichier supprimé. */
async function markError(db: SupabaseClient, item: Pick<Item, 'id' | 'storage_path'>, message: string) {
  const { error } = await db.from('inbox')
    .update({ status: 'error', error: shortError(message), processed_at: new Date().toISOString() })
    .eq('id', item.id).in('status', ['pending', 'processing'])
  if (error) fail('passage en erreur', error)
  return removeFile(db, item.storage_path)
}

/** Éléments en attente, du plus ancien au plus récent (métadonnées seulement, jamais le contenu). */
async function list(db: SupabaseClient) {
  const { data, error } = await db.from('inbox').select('id, kind, filename, mime, size, created_at').eq('status', 'pending').order('created_at')
  if (error) fail('lecture de la boîte de réception', error)
  return data
}

/**
 * Réclame un élément (pending → processing, atomique) puis écrit son contenu dans `dir` (`<id>.<ext>`, sans écraser).
 * Fichier : téléchargé, signature des octets vérifiée ; refusé → élément en erreur et fichier supprimé.
 */
async function claim(db: SupabaseClient, id: string, dir: string) {
  const st = await fs.stat(dir).catch(() => null)
  if (!st?.isDirectory()) throw new Error(`dossier introuvable : ${dir}`)
  const { data, error } = await db.from('inbox').update({ status: 'processing' }).eq('id', id).eq('status', 'pending')
    .select('id, kind, status, text, storage_path, filename, mime, size')
  if (error) fail('réclamation de l’élément', error)
  if (!data.length) throw new Error(`élément introuvable ou pas en attente : ${id}`)
  const item = data[0] as Item
  const target = claimPath(dir, id, item.kind, item.mime)

  if (item.kind === 'text') {
    await fs.writeFile(target, item.text ?? '', { flag: 'wx', mode: 0o600 })
    return { id, kind: 'text', path: target, chars: Array.from(item.text ?? '').length }
  }

  const dl = await db.storage.from(BUCKET).download(item.storage_path!)
  if (dl.error || !dl.data) {
    await markError(db, item, 'fichier introuvable dans le stockage')
    throw new Error(`fichier introuvable pour ${id} : élément passé en erreur`)
  }
  const bytes = new Uint8Array(await dl.data.arrayBuffer())
  const problem = fileProblem(bytes, item.mime!, item.size)
  if (problem) {
    const removed = await markError(db, item, `fichier refusé : ${problem}`)
    throw new Error(`fichier refusé pour ${id} (${problem}) : élément passé en erreur${removed ? ', fichier supprimé' : ''}`)
  }
  await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
  return { id, kind: 'file', path: target, mime: item.mime, size: bytes.length }
}

/**
 * Termine un élément `processing` : JSON validé avant toute écriture, cartes insérées en brouillon (source inbox,
 * rattachées à l'élément), élément `done`, puis fichier supprimé du stockage. Refuse un élément qui a déjà des cartes
 * (rejeu) : aucune carte en double.
 */
async function complete(db: SupabaseClient, id: string, file: string) {
  const payload = validateInboxPayload(JSON.parse(await fs.readFile(file, 'utf8')))
  const item = await getItem(db, id)
  if (item.status !== 'processing') throw new Error(`élément ${id} en statut « ${item.status} » : seul un élément réclamé (processing) peut être terminé`)
  const { data: existing, error: exError } = await inboxOnly(db.from('cards').select('id')).eq('inbox_id', id).limit(1)
  if (exError) fail('lecture des cartes de l’élément', exError)
  if (existing.length) throw new Error(`élément ${id} : des cartes existent déjà (rejeu refusé) ; vérifier dans l’app puis « inbox fail » si besoin`)

  if (payload.cards.length) {
    const rows = payload.cards.map(c => ({ source: INBOX_SOURCE, status: 'draft', inbox_id: id, source_title: payload.source_title, front: c.front, back: c.back, tags: c.tags }))
    const { error } = await db.from('cards').insert(rows)
    if (error) fail('ajout des brouillons', error)
  }
  const { data, error } = await db.from('inbox').update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'processing').select('id')
  if (error) fail('passage en done', error)
  if (data.length !== 1) throw new Error(`élément ${id} : statut modifié entre-temps (brouillons insérés, élément pas marqué done)`)
  return { id, drafts: payload.cards.length, file_removed: await removeFile(db, item.storage_path) }
}

/** Échec du traitement : élément en erreur (message court affiché dans l'app), fichier supprimé. */
async function failItem(db: SupabaseClient, id: string, message: string) {
  const item = await getItem(db, id)
  if (item.status !== 'pending' && item.status !== 'processing') throw new Error(`élément ${id} déjà terminé (${item.status})`)
  return { id, status: 'error', file_removed: await markError(db, item, message) }
}

/**
 * Ménage (à lancer en fin d'exécution) : fichiers restés dans le stockage pour un élément terminé (done/error), ou
 * orphelins (aucun élément, envoi abandonné) de plus de 24 h ; éléments bloqués en processing depuis plus de 24 h → erreur.
 */
async function purge(db: SupabaseClient) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString()
  const stale = await db.from('inbox').update({ status: 'error', error: 'traitement interrompu', processed_at: new Date().toISOString() })
    .eq('status', 'processing').lt('created_at', cutoff).select('id')
  if (stale.error) fail('éléments bloqués', stale.error)

  const files: { path: string; created_at: string }[] = []
  const root = await db.storage.from(BUCKET).list('', { limit: 1000 })
  if (root.error) fail('liste du stockage', root.error)
  for (const folder of root.data.filter(e => e.id === null)) {
    const res = await db.storage.from(BUCKET).list(folder.name, { limit: 1000 })
    if (res.error) fail('liste du stockage', res.error)
    for (const f of res.data) if (f.id !== null) files.push({ path: `${folder.name}/${f.name}`, created_at: f.created_at ?? new Date().toISOString() }) // date inconnue : jamais purgé comme orphelin
  }
  const status = new Map<string, string>()
  for (const paths of chunk(files.map(f => f.path), 50)) {
    const { data, error } = await db.from('inbox').select('storage_path, status').in('storage_path', paths)
    if (error) fail('lecture de la boîte de réception', error)
    for (const r of data as { storage_path: string; status: string }[]) status.set(r.storage_path, r.status)
  }
  const toRemove = files.filter(f => {
    const s = status.get(f.path)
    return s === 'done' || s === 'error' || (s === undefined && f.created_at < cutoff)
  }).map(f => f.path)
  let removed = 0
  for (const paths of chunk(toRemove, 100)) {
    const { data, error } = await db.storage.from(BUCKET).remove(paths)
    if (error) fail('suppression des fichiers', error)
    removed += (data ?? []).length
  }
  return { files_removed: removed, stale_marked_error: stale.data.length }
}

export function runInbox(db: SupabaseClient, cmd: InboxCommand): Promise<unknown> {
  switch (cmd.action) {
    case 'list': return list(db)
    case 'claim': return claim(db, cmd.id, cmd.dir)
    case 'complete': return complete(db, cmd.id, cmd.file)
    case 'fail': return failItem(db, cmd.id, cmd.message)
    case 'purge': return purge(db)
  }
}
