// Outil local (Mac) : lit les notes de veille du vault et écrit les cartes dans Supabase avec la clé secrète.
// Usage : node tools/cards/cli.ts scan | existing <source_path> | all | apply <fichier.json> [--confirm-delete=<n>] | retag <fichier.json>
// Sortie : JSON sur stdout uniquement. Erreurs sur stderr, code 1. Aucune valeur de variable d'environnement n'est jamais affichée.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  REMOVED_HASH, assertContentHashFresh, assertDeckMatchesPath, assertDeleteConfirmed, assertRemovedNoteGone, computeScan, countLiveCards, parseArgs, USAGE, diffCards, listSyntheses, planRetag, validatePayload, validateRetagPayload,
  type ExistingCard, type NoteRow, type RetagTarget,
} from './lib.ts'

const ENV_FILE = path.join(import.meta.dirname, '..', '..', '.env.local')
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const

/** Charge `.env.local` (une seule fois, aucun appel réseau) : à faire AVANT vaultRoot(), qui peut y lire VAULT_ROOT. */
let envLoaded = false
function loadEnv(): void {
  if (envLoaded) return
  try {
    process.loadEnvFile(ENV_FILE)
  } catch {
    throw new Error(`fichier introuvable ou illisible : ${ENV_FILE}`)
  }
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) throw new Error(`variable manquante dans .env.local : ${name}`)
  }
  envLoaded = true
}

function connect(): SupabaseClient {
  loadEnv()
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function vaultRoot(): string {
  return process.env.VAULT_ROOT ?? path.join(os.homedir(), 'Workspace')
}

function fail(step: string, error: { message: string }): never {
  throw new Error(`${step} : ${error.message}`)
}

async function fetchExisting(db: SupabaseClient, sourcePath: string): Promise<ExistingCard[]> {
  const { data, error } = await db
    .from('cards')
    .select('id, front, back, tags')
    .eq('source_path', sourcePath)
    .is('deleted_at', null)
    .order('created_at')
  if (error) fail('lecture des cartes', error)
  return data as ExistingCard[]
}

/** Toutes les cartes vivantes (lecture seule) : base de la procédure de re-tag. */
async function fetchAll(db: SupabaseClient) {
  const { data, error } = await db
    .from('cards')
    .select('id, source_path, front, back, tags')
    .is('deleted_at', null)
    .order('source_path')
    .order('created_at')
  if (error) fail('lecture des cartes', error)
  return data
}

async function scan() {
  const db = connect() // charge .env.local avant vaultRoot()
  const files = await listSyntheses(vaultRoot())
  const { data, error } = await db.from('notes').select('source_path, content_hash')
  if (error) fail('lecture des notes', error)
  const { changed, removed } = computeScan(files, data as NoteRow[])
  // `removed` : chemin + nombre de cartes vivantes, pour que Kyllian sache ce qu'une suppression coûterait.
  let live: { source_path: string }[] = []
  if (removed.length > 0) {
    const res = await db.from('cards').select('source_path').in('source_path', removed).is('deleted_at', null)
    if (res.error) fail('lecture des cartes', res.error)
    live = res.data
  }
  return { changed, removed: countLiveCards(removed, live) }
}

async function apply(file: string, confirmDelete: number | null) {
  // Contrôles locaux d'abord : rien n'est lu ni écrit en base si le payload est refusé.
  const payload = validatePayload(JSON.parse(await fs.readFile(file, 'utf8')))
  const { source_path, deck, content_hash } = payload
  assertDeckMatchesPath(source_path, deck)
  loadEnv() // même vault que scan : VAULT_ROOT peut venir de .env.local
  if (content_hash === REMOVED_HASH) {
    const stillExists = await fs.access(path.join(vaultRoot(), source_path)).then(() => true, () => false)
    assertRemovedNoteGone(source_path, stillExists)
  } else {
    let current: string
    try {
      current = await fs.readFile(path.join(vaultRoot(), source_path), 'utf8')
    } catch {
      throw new Error(`note introuvable dans le vault : ${source_path} (relancer scan)`)
    }
    assertContentHashFresh(content_hash, current)
  }
  const db = connect()
  const existing = await fetchExisting(db, source_path)
  const { toInsert, toUpdate, toDelete } = diffCards(existing, payload.cards)
  // Avant toute écriture : toute suppression (note removed OU carte retirée d'une note modifiée) exige --confirm-delete=<n exact>.
  const deleted = existing.filter(c => toDelete.includes(c.id))
  assertDeleteConfirmed(source_path, deleted, confirmDelete)

  // Chaque étape lève en cas d'échec : le hash de la note n'est alors pas écrit et elle sera retraitée au prochain scan.
  if (toInsert.length > 0) {
    const rows = toInsert.map(c => ({ deck, source_path, front: c.front, back: c.back, tags: c.tags }))
    const { error } = await db.from('cards').insert(rows)
    if (error) fail('ajout des cartes', error)
  }
  for (const c of toUpdate) {
    const { error } = await db
      .from('cards')
      .update({ front: c.front, back: c.back, tags: c.tags })
      .eq('id', c.id)
      .eq('source_path', source_path)
    if (error) fail(`modification de la carte ${c.id}`, error)
  }
  if (toDelete.length > 0) {
    const { error } = await db
      .from('cards')
      .update({ deleted_at: new Date().toISOString() })
      .in('id', toDelete)
      .eq('source_path', source_path)
    if (error) fail('suppression des cartes', error)
  }
  const { error } = await db
    .from('notes')
    .upsert({ source_path, content_hash, processed_at: new Date().toISOString() }, { onConflict: 'source_path' })
  if (error) fail('enregistrement du hash de la note', error)

  return { added: toInsert.length, updated: toUpdate.length, deleted: toDelete.length }
}

/** Ne modifie QUE la colonne tags, par id, des cartes vivantes. Jamais le texte ni l'id (progression intacte). */
async function retag(db: SupabaseClient, file: string) {
  const entries = validateRetagPayload(JSON.parse(await fs.readFile(file, 'utf8')))
  // Lecture sans filtre deleted_at : planRetag (testé) refuse lui-même les cartes supprimées.
  const existing: RetagTarget[] = []
  const ids = entries.map(e => e.id)
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('cards').select('id, tags, deleted_at').in('id', ids.slice(i, i + 100))
    if (error) fail('lecture des cartes', error)
    existing.push(...(data as RetagTarget[]))
  }
  const { toUpdate, unchanged } = planRetag(existing, entries)
  // Pas de transaction, mais idempotent : après une erreur, relancer le même fichier (les cartes déjà à jour sont « unchanged »).
  for (const e of toUpdate) {
    const { data, error } = await db.from('cards').update({ tags: e.tags }).eq('id', e.id).is('deleted_at', null).select('id')
    if (error) fail(`re-tag de la carte ${e.id}`, error)
    if (data.length === 0) throw new Error(`re-tag de la carte ${e.id} : aucune ligne modifiée (supprimée entre-temps ?)`)
  }
  return { updated: toUpdate.length, unchanged }
}

async function main(argv: string[]): Promise<unknown> {
  const { command, arg, confirmDelete } = parseArgs(argv)
  switch (command) {
    case 'scan':
      return scan()
    case 'existing':
      if (!arg) throw new Error(USAGE)
      return fetchExisting(connect(), arg)
    case 'all':
      return fetchAll(connect())
    case 'apply':
      if (!arg) throw new Error(USAGE)
      return apply(arg, confirmDelete)
    case 'retag':
      if (!arg) throw new Error(USAGE)
      return retag(connect(), arg)
    default:
      throw new Error(USAGE)
  }
}

try {
  const result = await main(process.argv.slice(2))
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} catch (err) {
  process.stderr.write(`erreur : ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
}
