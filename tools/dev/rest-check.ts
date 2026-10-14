// Vérification de l'API REST (PostgREST via supabase-js) pour les cartes manuelles (#54), avec un vrai compte.
// Usage : node tools/dev/rest-check.ts   (dans un terminal interactif)
// - Demande l'e-mail puis le mot de passe dans le terminal (mot de passe masqué, jamais stocké ni affiché).
// - Se connecte avec la clé PUBLISHABLE de l'app (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY), jamais la clé secrète.
// - Laisse une carte « [rest-check] … » supprimée en douce (aucune suppression physique n'est permise à l'app) :
//   invisible dans l'app (deleted_at posé).
// Code de sortie : 0 si toutes les étapes sont conformes, 1 sinon.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { expectDenied, expectRows, formatTable, pickPublicConfig, type ApiResponse, type StepResult } from './lib.ts'

const ENV_FILE = path.join(import.meta.dirname, '..', '..', '.env.local')

function readEnvFile(): string | null {
  try {
    return fs.readFileSync(ENV_FILE, 'utf8')
  } catch {
    return null
  }
}

/** Saisie masquée : rien n'est renvoyé à l'écran (pas même des étoiles). Ctrl-C annule. */
function askHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process
  if (!stdin.isTTY) throw new Error('terminal interactif requis (le mot de passe se tape au clavier)')
  stdout.write(prompt)
  return new Promise((resolve, reject) => {
    let value = ''
    const done = (fn: () => void) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      stdout.write('\n')
      fn()
    }
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(value))
        if (ch === '\u0003') return done(() => reject(new Error('annulé')))
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else if (ch >= ' ') value += ch
      }
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

const asResponse = (r: { data: unknown; error: { message: string; code?: string } | null; status: number }): ApiResponse =>
  ({ data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null, status: r.status })

async function main(): Promise<number> {
  const { url, key } = pickPublicConfig(process.env, readEnvFile())
  process.stdout.write(`Projet : ${new URL(url).host} (clé publishable de l’app)\n`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const email = (await rl.question('E-mail : ')).trim()
  rl.close()
  const password = await askHidden('Mot de passe (masqué) : ')

  const results: StepResult[] = []
  const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  // 0. Sans session (rôle anon) : aucun accès.
  results.push(expectDenied('anon : lire cards', asResponse(await anon.from('cards').select('id').limit(1))))

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const auth = await client.auth.signInWithPassword({ email, password })
  results.push({
    step: 'connexion (auth)', expected: 'session ouverte', status: auth.error?.status ?? 200,
    got: auth.error ? `erreur ${auth.error.message}` : 'session ouverte', ok: !auth.error && !!auth.data.session,
  })
  if (auth.error) {
    process.stdout.write('\n' + formatTable(results) + '\n')
    return 1
  }

  const id = crypto.randomUUID()
  const front = `[rest-check] ${new Date().toISOString()}`
  const card = { id, source: 'manual', front, back: 'Carte de test créée par tools/dev/rest-check.ts', tags: ['dev'] }

  // 1. Création (POST /rest/v1/cards), comme l'app : INSERT … ON CONFLICT (id) DO NOTHING.
  const created = asResponse(await client.from('cards').upsert(card, { onConflict: 'id', ignoreDuplicates: true }).select('id'))
  results.push(expectRows('créer une carte manual', '201, 1 ligne', created, 1, created.status === 201))

  // 2. Relecture (GET).
  const read = await client.from('cards').select('id, source, deck, source_path, front, tags, deleted_at').eq('id', id)
  const row = read.data?.[0]
  results.push(expectRows('relire la carte', '200, source manual, deck/source_path nuls', asResponse(read), 1,
    row?.source === 'manual' && row.deck === null && row.source_path === null && row.front === front))

  // 3. Envoi rejoué (réponse perdue) : aucune ligne insérée, pas d'erreur.
  const replay = asResponse(await client.from('cards').upsert(card, { onConflict: 'id', ignoreDuplicates: true }).select('id'))
  results.push(expectRows('renvoyer la même carte', '0 ligne, pas de doublon', replay, 0))

  // 4. Édition (PATCH) des colonnes autorisées.
  const edited = asResponse(await client.from('cards').update({ front: `${front} (modifiée)`, back: 'Réponse modifiée', tags: ['dev', 'ia'] }).eq('id', id).select('id, front'))
  results.push(expectRows('modifier front/back/tags', '200, 1 ligne', edited, 1))

  // 5. Colonnes interdites (source) et suppression physique (DELETE) : refusées.
  results.push(expectDenied('modifier la colonne source', asResponse(await client.from('cards').update({ source: 'vault' }).eq('id', id).select('id'))))
  results.push(expectDenied('supprimer (DELETE)', asResponse(await client.from('cards').delete().eq('id', id).select('id'))))

  // 6. Création d'une carte vault : refusée par la policy RLS.
  const vaultInsert = await client.from('cards').insert({ id: crypto.randomUUID(), source: 'vault', front: '[rest-check] vault', back: 'R', tags: ['dev'] }).select('id')
  results.push(expectDenied('créer une carte vault', asResponse(vaultInsert)))

  // 7. Modification d'une carte vault : invisible pour l'update (RLS) → 0 ligne, carte intacte.
  const target = await client.from('cards').select('id, front').eq('source', 'vault').is('deleted_at', null).limit(1)
  const vault = target.data?.[0]
  if (vault) {
    const attempt = asResponse(await client.from('cards').update({ front: '[rest-check] piratée' }).eq('id', vault.id).select('id'))
    const after = await client.from('cards').select('front').eq('id', vault.id)
    results.push(expectRows('modifier une carte vault', '0 ligne (RLS), carte intacte', attempt, 0, after.data?.[0]?.front === vault.front))
  } else {
    results.push({ step: 'modifier une carte vault', expected: '0 ligne (RLS)', status: target.status, got: 'aucune carte vault à viser', ok: false })
  }

  // 8. Suppression douce.
  const removed = asResponse(await client.from('cards').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id, deleted_at'))
  results.push(expectRows('suppression douce (deleted_at)', '200, 1 ligne', removed, 1))

  await client.auth.signOut()
  process.stdout.write('\n' + formatTable(results) + '\n')
  process.stdout.write(`\nCarte de test : ${id} (supprimée en douce, invisible dans l'app).\n`)
  return results.every(r => r.ok) ? 0 : 1
}

try {
  process.exitCode = await main()
} catch (err) {
  process.stderr.write(`erreur : ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
}
