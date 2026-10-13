// Outil local (Mac) : lit les notes de veille du vault et écrit les cartes dans Supabase avec la clé secrète.
// Usage : node tools/cards/cli.ts scan | existing <source_path> | all | apply <fichier.json> [--confirm-delete=<n>] | retag <fichier.json> | titles
// Sortie : JSON sur stdout uniquement. Erreurs sur stderr, code 1. Aucune valeur de variable d'environnement n'est jamais affichée.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  REMOVED_HASH, assertContentHashFresh, assertDeckMatchesPath, assertDeleteConfirmed, assertRemovedNoteGone, chunk, computeScan, cardsNeedingTitle, planTitles, resolveInVault, countLiveCards, parseArgs, USAGE, diffCards, listSyntheses, planRetag, validatePayload, validateRetagPayload,
  type ExistingCard, type NoteRow, type RetagTarget, type TitledCard,
} from './lib.ts'
import { extractTitle } from '../../shared/source-title.ts'

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

async function fetchExisting(db: SupabaseClient, sourcePath: string): Promise<(ExistingCard & { source_title: string | null })[]> {
  const { data, error } = await db
    .from('cards')
    .select('id, front, back, tags, source_title')
    .eq('source_path', sourcePath)
    .is('deleted_at', null)
    .order('created_at')
  if (error) fail('lecture des cartes', error)
  return data as (ExistingCard & { source_title: string | null })[]
}

/** Toutes les cartes vivantes (lecture seule) : base de la procédure de re-tag. */
async function fetchAll(db: SupabaseClient) {
  const { data, error } = await db
    .from('cards')
    .select('id, source_path, source_title, front, back, tags')
    .is('deleted_at', null)
    .order('source_path')
    .order('created_at')
  if (error) fail('lecture des cartes', error)
  return data
}

/** Un `source_path` par carte vivante des notes données. Paquets de chemins (URL courte) et pagination (plafond PostgREST de 1000 lignes). */
const PATHS_PER_QUERY = 20 // chemins longs + emojis encodés : on reste loin de la limite de longueur d'URL
const PAGE_SIZE = 1000
async function fetchLiveCardPaths(db: SupabaseClient, paths: string[]): Promise<{ source_path: string }[]> {
  const rows: { source_path: string }[] = []
  for (const group of chunk(paths, PATHS_PER_QUERY)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await db
        .from('cards')
        .select('source_path')
        .in('source_path', group)
        .is('deleted_at', null)
        .order('id')
        .range(from, from + PAGE_SIZE - 1)
      if (error) fail('lecture des cartes', error)
      rows.push(...data)
      if (data.length < PAGE_SIZE) break
    }
  }
  return rows
}

async function scan() {
  const db = connect() // charge .env.local avant vaultRoot()
  const files = await listSyntheses(vaultRoot())
  const { data, error } = await db.from('notes').select('source_path, content_hash')
  if (error) fail('lecture des notes', error)
  const { changed, removed } = computeScan(files, data as NoteRow[])
  // `removed` : chemin + nombre de cartes vivantes, pour que Kyllian sache ce qu'une suppression coûterait.
  const live = await fetchLiveCardPaths(db, removed)
  return { changed, removed: countLiveCards(removed, live) }
}

async function apply(file: string, confirmDelete: number | null) {
  // Contrôles locaux d'abord : rien n'est lu ni écrit en base si le payload est refusé.
  const payload = validatePayload(JSON.parse(await fs.readFile(file, 'utf8')))
  const { source_path, deck, content_hash, source_title } = payload
  assertDeckMatchesPath(source_path, deck)
  loadEnv() // même vault que scan : VAULT_ROOT peut venir de .env.local
  if (content_hash === REMOVED_HASH) {
    const stillExists = await fs.access(resolveInVault(vaultRoot(), source_path)).then(() => true, () => false)
    assertRemovedNoteGone(source_path, stillExists)
  } else {
    const abs = resolveInVault(vaultRoot(), source_path)
    let current: string
    try {
      current = await fs.readFile(abs, 'utf8')
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
    const rows = toInsert.map(c => ({ deck, source_path, source_title, front: c.front, back: c.back, tags: c.tags }))
    const { error } = await db.from('cards').insert(rows)
    if (error) fail('ajout des cartes', error)
  }
  for (const c of toUpdate) {
    const { error } = await db
      .from('cards')
      .update({ front: c.front, back: c.back, tags: c.tags, source_title })
      .eq('id', c.id)
      .eq('source_path', source_path)
    if (error) fail(`modification de la carte ${c.id}`, error)
  }
  // Cartes conservées telles quelles : seul le titre de la source est aligné (id, texte et tags intacts).
  // `removed` n'a pas de titre : source_title est alors undefined, la liste est vide.
  const titleIds = source_title === undefined
    ? []
    : cardsNeedingTitle(existing, source_title, new Set(toUpdate.map(c => c.id)), new Set(toDelete))
  if (titleIds.length > 0) {
    const { data, error } = await db.from('cards').update({ source_title }).in('id', titleIds).eq('source_path', source_path).is('deleted_at', null).select('id')
    if (error) fail('mise à jour du titre des cartes', error)
    if (data.length !== titleIds.length) {
      throw new Error(`mise à jour du titre des cartes de ${source_path} : ${data.length} ligne(s) modifiée(s) sur ${titleIds.length} (cartes supprimées entre-temps ? relancer apply)`)
    }
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

/**
 * Remplit `source_title` des cartes vivantes depuis le fichier sur disque (H1 de la note, sinon nom de fichier).
 * Ne modifie QUE cette colonne, jamais id/front/back/tags (progression intacte). Idempotent.
 * Refuse tout (rien d'écrit) si un fichier source est introuvable.
 */
async function titles(db: SupabaseClient) {
  const cards: TitledCard[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('cards')
      .select('id, source_path, source_title')
      .is('deleted_at', null)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) fail('lecture des cartes', error)
    cards.push(...(data as TitledCard[]))
    if (data.length < PAGE_SIZE) break
  }
  const found = new Map<string, string>()
  for (const source_path of new Set(cards.map(c => c.source_path))) {
    try {
      found.set(source_path, extractTitle(await fs.readFile(resolveInVault(vaultRoot(), source_path), 'utf8'), path.basename(source_path)))
    } catch {
      // introuvable : signalé par planTitles, qui refuse avant toute écriture
    }
  }
  const { toUpdate, unchanged } = planTitles(cards, found)
  let updated = 0
  for (const g of toUpdate) {
    for (const ids of chunk(g.ids, 100)) {
      const { data, error } = await db.from('cards').update({ source_title: g.source_title }).in('id', ids).is('deleted_at', null).select('id')
      if (error) fail('mise à jour du titre des cartes', error)
      if (data.length !== ids.length) throw new Error(`mise à jour du titre « ${g.source_title} » : ${data.length} ligne(s) modifiée(s) sur ${ids.length} (cartes supprimées entre-temps ? relancer)`)
      updated += data.length
    }
  }
  return { updated, unchanged }
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
    case 'titles':
      if (arg) throw new Error(USAGE)
      return titles(connect())
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
