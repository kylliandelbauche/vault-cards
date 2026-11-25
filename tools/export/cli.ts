// Export de la PWA vers l'app native (tranche 4, docs/plans/2026-11-25-app-apple-native.md) : lit toutes les cartes et
// révisions dans Supabase avec la clé secrète (lecture seule, rien n'est modifié côté Supabase) et les écrit au
// format v1 dans le dossier de synchro choisi dans l'app, comme un appareil de plus (« Import de la PWA »).
// Usage : node tools/export/cli.ts <dossier choisi dans l'app>   (le sous-dossier VaultCards/ est créé s'il manque)
// Sortie : résumé JSON sur stdout. Erreurs sur stderr, code 1. Aucune valeur de variable d'environnement n'est affichée,
// ni aucun contenu de carte.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readAllByKey } from '../cards/lib.ts'
import { deviceFiles, formatFile, type CardRow, type ReviewRow } from './lib.ts'

const ENV_FILE = path.join(import.meta.dirname, '..', '..', '.env.local')
const ROOT = 'VaultCards'

function connect(): SupabaseClient {
  try {
    process.loadEnvFile(ENV_FILE)
  } catch {
    throw new Error(`fichier introuvable ou illisible : ${ENV_FILE}`)
  }
  for (const name of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[name]) throw new Error(`variable manquante dans .env.local : ${name}`)
  }
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

const CARD_COLUMNS = 'id, source, status, front, back, tags, deleted_at, created_at, updated_at, deck, source_path, source_title'

async function readAll<T extends { id: string }>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  return readAllByKey<T>(async (after, limit) => {
    let query = db.from(table).select(columns)
    if (after !== null) query = query.gt('id', after)
    const { data, error } = await query.order('id').limit(limit)
    if (error) throw new Error(`lecture de ${table} : ${error.message}`)
    return data as unknown as T[]
  })
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

async function main(): Promise<void> {
  const target = process.argv[2]
  if (!target || process.argv.length > 3) throw new Error("usage : node tools/export/cli.ts <dossier choisi dans l'app>")
  const stat = await fs.stat(target).catch(() => null)
  if (!stat?.isDirectory()) throw new Error(`dossier introuvable : ${target}`)
  const root = path.join(target, ROOT)

  const db = connect()
  const cards = await readAll<CardRow>(db, 'cards', CARD_COLUMNS)
  const reviews = await readAll<ReviewRow>(db, 'reviews', 'id, card_id, rating, reviewed_at')

  const device = randomUUID().toLowerCase()
  const format = formatFile(await readIfExists(path.join(root, 'format.json')))
  const files = [...(format ? [format] : []), ...deviceFiles(device, new Date(), cards, reviews)]

  await fs.mkdir(path.join(root, 'devices', device), { recursive: true })
  // `wx` : n'écrase jamais un fichier existant (le dossier de l'appareil est neuf).
  for (const f of files) await fs.writeFile(path.join(root, f.path), f.contents, { flag: 'wx' })

  process.stdout.write(JSON.stringify({
    device,
    cards: cards.length,
    deleted: cards.filter(c => c.deleted_at !== null).length,
    drafts: cards.filter(c => c.status === 'draft').length,
    reviews: reviews.length,
    files: files.map(f => path.join(ROOT, f.path)),
  }, null, 2) + '\n')
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
