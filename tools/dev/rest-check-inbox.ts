// Vérification de la boîte de réception (#55) par l'API REST et Storage (supabase-js), avec un vrai compte.
// Usage : node tools/dev/rest-check-inbox.ts   (dans un terminal interactif)
// - Demande l'e-mail puis le mot de passe (saisie masquée, jamais stockée ni affichée).
// - Clé PUBLISHABLE de l'app seulement (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY), jamais la clé secrète.
// - Dépose un texte, un petit fichier texte, un .md et un petit audio marqués « [rest-check] » (restent en attente : l'app ne peut pas supprimer
//   d'élément ; voir docs/rest-check.md pour la purge), vérifie que le fichier ne peut être ni relu, ni listé, ni
//   remplacé, ni supprimé, puis lit les statuts.
// - Si un brouillon issu d'un texte [rest-check] existe (après un passage de /flashcards), l'accepte, vérifie qu'il ne
//   peut pas repasser en brouillon, puis le supprime en douce (aucune vraie carte touchée).
// Code de sortie : 0 si toutes les étapes sont conformes, 1 sinon.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { createClient } from '@supabase/supabase-js'
import { expectDenied, expectRows, formatTable, pickPublicConfig, typeKeys, type ApiResponse, type StepResult } from './lib.ts'

const ENV_FILE = path.join(import.meta.dirname, '..', '..', '.env.local')

function readEnvFile(): string | null {
  try {
    return fs.readFileSync(ENV_FILE, 'utf8')
  } catch {
    return null
  }
}

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
      const typed = typeKeys(value, chunk.toString('utf8'))
      value = typed.value
      if (typed.done === 'enter') done(() => resolve(value))
      else if (typed.done === 'cancel') done(() => reject(new Error('annulé')))
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onData)
  })
}

const asResponse = (r: { data: unknown; error: { message: string; code?: string } | null; status: number }): ApiResponse =>
  ({ data: r.data, error: r.error ? { message: r.error.message, code: r.error.code } : null, status: r.status })

/** Erreur Storage (pas de code PostgreSQL) : statut HTTP si présent. */
const storageStatus = (e: unknown) => (e && typeof e === 'object' && 'status' in e && typeof e.status === 'number' ? e.status : 0)

const step = (name: string, expected: string, ok: boolean, got: string, status = 0): StepResult => ({ step: name, expected, status, got, ok })

async function main(): Promise<number> {
  const { url, key } = pickPublicConfig(process.env, readEnvFile())
  process.stdout.write(`Projet : ${new URL(url).host} (clé publishable de l’app)\n`)

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const email = (await rl.question('E-mail : ')).trim()
  rl.close()
  const password = await askHidden('Mot de passe (masqué) : ')

  const results: StepResult[] = []
  const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  // 0. Sans session : aucun accès.
  results.push(expectDenied('anon : lire inbox', asResponse(await anon.from('inbox').select('id').limit(1))))
  const anonRpc = await anon.rpc('create_inbox_item', { p_id: crypto.randomUUID(), p_kind: 'text', p_text: '[rest-check] anon' })
  results.push(expectDenied('anon : create_inbox_item', asResponse(anonRpc)))
  const anonUp = await anon.storage.from('inbox').upload(`${crypto.randomUUID()}/${crypto.randomUUID()}`, new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' })
  results.push(step('anon : déposer un fichier', 'refusé', !!anonUp.error, anonUp.error ? `refus ${anonUp.error.message}` : 'accepté', storageStatus(anonUp.error)))

  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const auth = await client.auth.signInWithPassword({ email, password })
  results.push(step('connexion (auth)', 'session ouverte', !auth.error && !!auth.data.session, auth.error ? `erreur ${auth.error.message}` : 'session ouverte', auth.error?.status ?? 200))
  if (auth.error || !auth.data.session) {
    process.stdout.write('\n' + formatTable(results) + '\n')
    return 1
  }
  const uid = auth.data.session.user.id
  const stamp = new Date().toISOString()

  // 1. Texte collé (RPC, statut forcé pending).
  const textId = crypto.randomUUID()
  const text = await client.rpc('create_inbox_item', { p_id: textId, p_kind: 'text', p_text: `[rest-check] ${stamp} — Les mitochondries produisent l'essentiel de l'énergie (ATP) de la cellule.` })
  results.push(step('déposer un texte (RPC)', 'élément pending', !text.error && text.data?.status === 'pending', text.error ? `erreur ${text.error.message}` : `status ${text.data?.status}`, text.status))

  // 2. Petit fichier texte : envoi dans <uid>/<id>, puis création de l'élément (taille/type lus sur l'objet stocké).
  const fileId = crypto.randomUUID()
  const objectPath = `${uid}/${fileId}`
  const body = new Blob([`[rest-check] ${stamp} fichier de test\n`], { type: 'text/plain' })
  const up = await client.storage.from('inbox').upload(objectPath, body, { contentType: 'text/plain', upsert: false })
  results.push(step('envoyer un fichier dans inbox/<uid>/<id>', 'accepté', !up.error, up.error ? `erreur ${up.error.message}` : 'envoyé', storageStatus(up.error) || 200))
  const fileItem = await client.rpc('create_inbox_item', { p_id: fileId, p_kind: 'file', p_filename: `rest-check-${stamp.slice(0, 10)}.txt` })
  results.push(step('créer l’élément fichier (RPC)', 'pending, text/plain, taille exacte',
    !fileItem.error && fileItem.data?.status === 'pending' && fileItem.data.mime === 'text/plain' && fileItem.data.size === body.size,
    fileItem.error ? `erreur ${fileItem.error.message}` : `${fileItem.data?.status} ${fileItem.data?.mime} ${fileItem.data?.size} o`, fileItem.status))

  // 2 bis. Fichier .md comme l'app l'envoie (src/lib/inbox.ts) : corps sans type réemballé en text/markdown.
  const mdId = crypto.randomUUID()
  const md = new Blob([new Blob([`# [rest-check] ${stamp}\n- fichier Markdown de test\n`])], { type: 'text/markdown' })
  const mdUp = await client.storage.from('inbox').upload(`${uid}/${mdId}`, md, { contentType: 'text/markdown', upsert: false })
  const mdItem = mdUp.error ? null : await client.rpc('create_inbox_item', { p_id: mdId, p_kind: 'file', p_filename: `rest-check-${stamp.slice(0, 10)}.md` })
  results.push(step('envoyer un .md (type réemballé)', 'pending, text/markdown',
    !mdUp.error && !mdItem?.error && mdItem?.data?.mime === 'text/markdown',
    mdUp.error ? `envoi refusé ${mdUp.error.message}` : mdItem?.error ? `erreur ${mdItem.error.message}` : `${mdItem?.data?.status} ${mdItem?.data?.mime}`, mdItem?.status ?? storageStatus(mdUp.error)))

  // 2 ter. Audio (#48) : type sans paramètre, comme l'app l'envoie (le bucket compare le type exact). Contenu factice : `inbox fail` le purge.
  const audioId = crypto.randomUUID()
  const audio = new Blob([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20])], { type: 'audio/mp4' })
  const audioUp = await client.storage.from('inbox').upload(`${uid}/${audioId}`, audio, { contentType: 'audio/mp4', upsert: false })
  const audioItem = audioUp.error ? null : await client.rpc('create_inbox_item', { p_id: audioId, p_kind: 'file', p_filename: `rest-check-${stamp.slice(0, 10)}.m4a` })
  results.push(step('envoyer un audio (type normalisé)', 'pending, audio/mp4',
    !audioUp.error && !audioItem?.error && audioItem?.data?.mime === 'audio/mp4',
    audioUp.error ? `envoi refusé ${audioUp.error.message}` : audioItem?.error ? `erreur ${audioItem.error.message}` : `${audioItem?.data?.status} ${audioItem?.data?.mime}`, audioItem?.status ?? storageStatus(audioUp.error)))

  // 3. Le fichier ne peut être ni relu, ni listé, ni remplacé, ni supprimé par l'app.
  const dl = await client.storage.from('inbox').download(objectPath)
  results.push(step('relire le fichier', 'refusé', !!dl.error && !dl.data, dl.error ? `refus ${dl.error.message}` : 'lu', storageStatus(dl.error)))
  const ls = await client.storage.from('inbox').list(uid)
  results.push(step('lister le dossier', '0 objet visible', !ls.error ? (ls.data ?? []).length === 0 : true, ls.error ? `refus ${ls.error.message}` : `${(ls.data ?? []).length} objet(s)`))
  const over = await client.storage.from('inbox').upload(objectPath, new Blob(['écrasé'], { type: 'text/plain' }), { contentType: 'text/plain', upsert: true })
  results.push(step('remplacer le fichier (upsert)', 'refusé', !!over.error, over.error ? `refus ${over.error.message}` : 'remplacé', storageStatus(over.error)))
  const rm = await client.storage.from('inbox').remove([objectPath])
  results.push(step('supprimer le fichier', '0 objet supprimé', !!rm.error || (rm.data ?? []).length === 0, rm.error ? `refus ${rm.error.message}` : `${(rm.data ?? []).length} supprimé(s)`))
  const foreign = await client.storage.from('inbox').upload(`${crypto.randomUUID()}/${crypto.randomUUID()}`, new Blob(['x'], { type: 'text/plain' }), { contentType: 'text/plain' })
  results.push(step('déposer dans le dossier d’un autre uid', 'refusé', !!foreign.error, foreign.error ? `refus ${foreign.error.message}` : 'accepté', storageStatus(foreign.error)))

  // 4. Écriture directe dans la table : refusée (statut forcé par la RPC).
  results.push(expectDenied('insérer dans inbox (status done)', asResponse(await client.from('inbox').insert({ kind: 'text', text: '[rest-check] direct', status: 'done' }).select('id'))))

  // 5. Statuts.
  const listed = await client.from('inbox').select('id, kind, status').in('id', [textId, fileId, mdId, audioId])
  results.push(expectRows('lister mes éléments', '200, 4 lignes', asResponse(listed), 4))

  // 6. Brouillon de test (issu d'un texte [rest-check] traité par /flashcards) : accepter, pas de retour en brouillon, puis suppression douce.
  const testItems = await client.from('inbox').select('id').like('text', '[rest-check]%').eq('status', 'done')
  const ids = (testItems.data ?? []).map(r => r.id)
  const drafts = ids.length
    ? await client.from('cards').select('id').eq('source', 'inbox').eq('status', 'draft').is('deleted_at', null).in('inbox_id', ids).limit(1)
    : { data: [] as { id: string }[] }
  const draft = drafts.data?.[0]
  if (draft) {
    const accepted = asResponse(await client.from('cards').update({ status: 'active' }).eq('id', draft.id).eq('source', 'inbox').select('id'))
    results.push(expectRows('accepter un brouillon de test', '200, 1 ligne', accepted, 1))
    const back = await client.from('cards').update({ status: 'draft' }).eq('id', draft.id).select('id')
    results.push(step('repasser la carte en brouillon', 'refusé (23514)', back.error?.code === '23514', back.error ? `refus ${back.error.code} ${back.error.message}` : 'accepté', back.status))
    const removed = asResponse(await client.from('cards').update({ deleted_at: new Date().toISOString() }).eq('id', draft.id).select('id'))
    results.push(expectRows('supprimer en douce le brouillon de test', '200, 1 ligne', removed, 1))
  } else {
    process.stdout.write('\n(aucun brouillon de test : lancer /flashcards pour traiter les éléments [rest-check], puis relancer ce script pour tester l’acceptation)\n')
  }

  await client.auth.signOut()
  process.stdout.write('\n' + formatTable(results) + '\n')
  process.stdout.write(`\nÉléments de test : ${textId} (texte), ${fileId} (fichier), ${mdId} (.md), ${audioId} (audio) — en attente ; purge : docs/rest-check.md.\n`)
  return results.every(r => r.ok) ? 0 : 1
}

try {
  process.exitCode = await main()
} catch (err) {
  process.stderr.write(`erreur : ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
}
