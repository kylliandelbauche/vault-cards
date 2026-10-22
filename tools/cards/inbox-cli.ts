// Boîte de réception (#55), accès base et Storage de l'outil (clé secrète, appelé par cli.ts : `inbox …`).
// Cartes : uniquement source = 'inbox' (inboxOnly), insérées en brouillon. Les cartes vault et manual ne sont jamais
// lues ni modifiées ici (vérifié par inbox.test.ts). Le contenu des documents n'est jamais affiché : il est écrit
// dans le dossier de l'exécution (RUN_DIR) pour que l'agent le lise, et traité comme de la donnée.
import fs from 'node:fs/promises'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canonicalTags, chunk, readAllByKey } from './lib.ts'
import { INBOX_SOURCE, PENDING_EXPIRY_MS, STALE_MS, assertRunDir, claimPath, fileProblem, payloadPath, readPayload, shortError, validateInboxPayload, type InboxCommand } from './inbox.ts'

const BUCKET = 'inbox'

/** Restreint une requête sur la table des cartes aux cartes de la boîte de réception. Seule porte d'accès de ce fichier à la table. */
export function inboxOnly<Q>(query: Q): Q {
  return (query as Q & { eq(column: string, value: string): Q }).eq('source', INBOX_SOURCE)
}

function fail(step: string, error: { message: string }): never {
  throw new Error(`${step} : ${error.message}`)
}

interface Item { id: string; kind: 'text' | 'file'; status: string; text: string | null; storage_path: string | null; filename: string | null; mime: string | null; size: number | null }

/**
 * Noms des tags existants (#79), table `tags` en lecture seule. Aucune écriture : un tag est créé par le trigger serveur
 * quand une carte active le porte (carte du vault à apply, brouillon à sa validation dans l'app).
 */
export async function fetchTagNames(db: SupabaseClient): Promise<string[]> {
  // Pagination par clé (#70) sur l'id du tag : l'ordre des noms n'a pas d'importance pour les appelants (tagCounts trie).
  const rows = await readAllByKey<{ id: string; name: string }>(async (after, limit) => {
    let query = db.from('tags').select('id, name')
    if (after !== null) query = query.gt('id', after)
    const { data, error } = await query.order('id').limit(limit)
    if (error) fail('lecture des tags', error)
    return data
  })
  return rows.map(t => t.name)
}

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

/** Éléments en attente, du plus ancien au plus récent (métadonnées utiles seulement : ni contenu ni nom de fichier saisi). */
async function list(db: SupabaseClient) {
  const { data, error } = await db.from('inbox').select('id, kind, mime, size, created_at').eq('status', 'pending').order('created_at')
  if (error) fail('lecture de la boîte de réception', error)
  return data
}

/**
 * Réclame un élément (pending → processing, atomique) puis écrit son contenu dans `dir` (`<id>.<ext>`, sans écraser).
 * Fichier : téléchargé, signature des octets vérifiée ; refusé → élément en erreur et fichier supprimé.
 */
async function claim(db: SupabaseClient, id: string, runDir: string) {
  const dir = await assertRunDir(runDir) // avant toute écriture en base
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
 * Termine un élément : lit `<RUN_DIR>/<id>.json` (seul fichier accepté), le valide avant toute écriture, puis, dans un
 * ordre rejouable : 1. brouillons insérés (source inbox, rattachés à l'élément) en une seule requête, donc tous ou aucun ;
 * 2. élément `done` ; 3. fichier supprimé. Rejeu après un échec au milieu : si des brouillons existent déjà, l'insertion
 * est sautée (aucun doublon) ; un élément déjà `done` ne fait que retenter la suppression du fichier.
 */
async function complete(db: SupabaseClient, id: string, runDir: string) {
  const dir = await assertRunDir(runDir)
  const payload = validateInboxPayload(await readPayload(payloadPath(dir, id)))
  // Orthographe des tags existants reprise ; les nouveaux noms restent de simples noms sur le brouillon (pas de création).
  payload.cards = canonicalTags(payload.cards, await fetchTagNames(db))
  const item = await getItem(db, id)
  if (item.status !== 'processing' && item.status !== 'done') {
    throw new Error(`élément ${id} en statut « ${item.status} » : seul un élément réclamé (processing) peut être terminé`)
  }
  const { count, error: exError } = await inboxOnly(db.from('cards').select('id', { count: 'exact', head: true })).eq('inbox_id', id)
  if (exError) fail('lecture des cartes de l’élément', exError)
  const already = count ?? 0
  if (item.status === 'done') return { id, drafts: already, replay: true, file_removed: await removeFile(db, item.storage_path) }

  if (payload.cards.length && already === 0) {
    const rows = payload.cards.map(c => ({ source: INBOX_SOURCE, status: 'draft', inbox_id: id, source_title: payload.source_title, front: c.front, back: c.back, tags: c.tags }))
    const { error } = await db.from('cards').insert(rows)
    if (error) fail('ajout des brouillons', error)
  }
  const { data, error } = await db.from('inbox').update({ status: 'done', processed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'processing').select('id')
  if (error) fail('passage en done', error)
  if (data.length !== 1) throw new Error(`élément ${id} : statut modifié entre-temps (brouillons insérés, élément pas marqué done ; relancer complete)`)
  return { id, drafts: already || payload.cards.length, replay: already > 0, file_removed: await removeFile(db, item.storage_path) }
}

/** Échec du traitement : élément en erreur (message court affiché dans l'app), fichier supprimé. */
async function failItem(db: SupabaseClient, id: string, message: string) {
  const item = await getItem(db, id)
  if (item.status !== 'pending' && item.status !== 'processing') throw new Error(`élément ${id} déjà terminé (${item.status})`)
  return { id, status: 'error', file_removed: await markError(db, item, message) }
}

/**
 * Ménage (à lancer en fin d'exécution) : fichiers restés dans le stockage pour un élément terminé (done/error), ou
 * orphelins (aucun élément, envoi abandonné) de plus de 24 h ; éléments bloqués en processing depuis plus de 24 h → erreur ;
 * éléments en attente depuis plus de 7 jours → erreur « expiré ».
 */
const LIST_PAGE = 1000

/** Toutes les entrées d'un dossier du bucket, page par page. */
async function listAll(db: SupabaseClient, prefix: string) {
  const out: { name: string; id: string | null; created_at: string | null }[] = []
  for (let offset = 0; ; offset += LIST_PAGE) {
    const res = await db.storage.from(BUCKET).list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (res.error) fail('liste du stockage', res.error)
    out.push(...res.data)
    if (res.data.length < LIST_PAGE) return out
  }
}

async function purge(db: SupabaseClient) {
  const now = Date.now()
  const cutoff = new Date(now - STALE_MS).toISOString()
  const stale = await db.from('inbox').update({ status: 'error', error: 'traitement interrompu', processed_at: new Date(now).toISOString() })
    .eq('status', 'processing').lt('created_at', cutoff).select('id')
  if (stale.error) fail('éléments bloqués', stale.error)
  // Jamais traités depuis 7 jours : expirés (libèrent la limite de 10) ; leurs fichiers partent ci-dessous (statut error).
  const expired = await db.from('inbox').update({ status: 'error', error: 'expiré', processed_at: new Date(now).toISOString() })
    .eq('status', 'pending').lt('created_at', new Date(now - PENDING_EXPIRY_MS).toISOString()).select('id')
  if (expired.error) fail('éléments expirés', expired.error)

  const files: { path: string; created_at: string }[] = []
  for (const folder of (await listAll(db, '')).filter(e => e.id === null)) {
    for (const f of await listAll(db, folder.name)) {
      // date inconnue : jamais purgé comme orphelin
      if (f.id !== null) files.push({ path: `${folder.name}/${f.name}`, created_at: f.created_at ?? new Date(now).toISOString() })
    }
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
  return { files_removed: removed, stale_marked_error: stale.data.length, pending_expired: expired.data.length }
}

export function runInbox(db: SupabaseClient, cmd: InboxCommand): Promise<unknown> {
  switch (cmd.action) {
    case 'list': return list(db)
    case 'claim': return claim(db, cmd.id, cmd.dir)
    case 'complete': return complete(db, cmd.id, cmd.dir)
    case 'fail': return failItem(db, cmd.id, cmd.message)
    case 'purge': return purge(db)
  }
}
