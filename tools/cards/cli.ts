// Outil local (Mac) : lit les notes de veille du vault et écrit les cartes dans Supabase avec la clé secrète.
// Usage : node tools/cards/cli.ts scan | existing <source_path> | apply <fichier.json>
// Sortie : JSON sur stdout uniquement. Erreurs sur stderr, code 1. Aucune valeur de variable d'environnement n'est jamais affichée.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  computeScan, diffCards, listSyntheses, validatePayload,
  type ExistingCard, type NoteRow,
} from './lib.ts'

const ENV_FILE = path.join(import.meta.dirname, '..', '..', '.env.local')
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] as const

function connect(): SupabaseClient {
  try {
    process.loadEnvFile(ENV_FILE)
  } catch {
    throw new Error(`fichier introuvable ou illisible : ${ENV_FILE}`)
  }
  for (const name of REQUIRED_ENV) {
    if (!process.env[name]) throw new Error(`variable manquante dans .env.local : ${name}`)
  }
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
    .select('id, front, back')
    .eq('source_path', sourcePath)
    .is('deleted_at', null)
    .order('created_at')
  if (error) fail('lecture des cartes', error)
  return data as ExistingCard[]
}

async function scan(db: SupabaseClient) {
  const files = await listSyntheses(vaultRoot())
  const { data, error } = await db.from('notes').select('source_path, content_hash')
  if (error) fail('lecture des notes', error)
  return computeScan(files, data as NoteRow[])
}

async function apply(db: SupabaseClient, file: string) {
  const payload = validatePayload(JSON.parse(await fs.readFile(file, 'utf8')))
  const { source_path, deck, content_hash } = payload
  const existing = await fetchExisting(db, source_path)
  const { toInsert, toUpdate, toDelete } = diffCards(existing, payload.cards)

  // Chaque étape lève en cas d'échec : le hash de la note n'est alors pas écrit et elle sera retraitée au prochain scan.
  if (toInsert.length > 0) {
    const rows = toInsert.map(c => ({ deck, source_path, front: c.front, back: c.back }))
    const { error } = await db.from('cards').insert(rows)
    if (error) fail('ajout des cartes', error)
  }
  for (const c of toUpdate) {
    const { error } = await db
      .from('cards')
      .update({ front: c.front, back: c.back })
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

const USAGE = 'usage : node tools/cards/cli.ts scan | existing <source_path> | apply <fichier.json>'

async function main(argv: string[]): Promise<unknown> {
  const [command, arg] = argv
  switch (command) {
    case 'scan':
      return scan(connect())
    case 'existing':
      if (!arg) throw new Error(USAGE)
      return fetchExisting(connect(), arg)
    case 'apply':
      if (!arg) throw new Error(USAGE)
      return apply(connect(), arg)
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
