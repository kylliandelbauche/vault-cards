// Boîte de réception (#55), partie pure (testée) : signatures d'octets, validation du JSON de l'IA, arguments.
// Les accès base/Storage sont dans inbox-cli.ts. Limites alignées sur les migrations 20261015010000_inbox, 20261030000000_inbox_audio et src/lib/inbox.ts.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SOURCE_TITLE_MAX } from '../../shared/source-title.ts'
import { requireTagList } from './lib.ts'

/** Origine des cartes créées par les commandes `inbox` : toujours en brouillon, jamais `vault` ni `manual`. */
export const INBOX_SOURCE = 'inbox'

export const MIME_EXT: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
}

export const FILE_MAX = 30 * 1024 * 1024
export const IMAGE_MAX = 10 * 1024 * 1024
export const CARDS_MAX = 50
const FRONT_MAX = 500
const BACK_MAX = 1500
export const ERROR_MAX = 300

const startsWith = (bytes: Uint8Array, sig: readonly number[], at = 0) => sig.every((b, i) => bytes[at + i] === b)
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))

export type AudioFormat = 'mov' | 'matroska' | 'wav' | 'mp3'

/**
 * Format d'un audio d'après ses octets (démuxeur ffmpeg), ou null. MP3 : `ID3`, ou un en-tête de trame : synchro sur
 * 11 bits, version connue, couche II ou III, débit et fréquence valides. Refuse donc `FF FE` (BOM UTF-16) et `FF FF`.
 */
export function audioFormat(bytes: Uint8Array): AudioFormat | null {
  if (startsWith(bytes, ascii('ftyp'), 4)) return 'mov'
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'matroska'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WAVE'), 8)) return 'wav'
  if (startsWith(bytes, ascii('ID3'))) return 'mp3'
  if (bytes.length < 3 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return null
  const version = (bytes[1] >> 3) & 3
  const layer = (bytes[1] >> 1) & 3
  const bitrate = bytes[2] >> 4
  const sampleRate = (bytes[2] >> 2) & 3
  return version !== 1 && (layer === 1 || layer === 2) && bitrate !== 0xf && sampleRate !== 3 ? 'mp3' : null
}

/**
 * Les octets correspondent-ils au type déclaré ? PDF `%PDF-`, PNG, JPEG `FF D8 FF`, WebP `RIFF….WEBP`, texte = UTF-8
 * valide sans octet nul, audio : voir audioFormat. Un fichier dont le contenu ne correspond pas (exécutable renommé, archive…) est refusé.
 */
export function matchesSignature(bytes: Uint8Array, mime: string): boolean {
  switch (mime) {
    case 'application/pdf':
      return startsWith(bytes, ascii('%PDF-'))
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/webp':
      return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a':
      return audioFormat(bytes) === 'mov'
    case 'audio/webm':
      return audioFormat(bytes) === 'matroska'
    case 'audio/wav':
    case 'audio/x-wav':
      return audioFormat(bytes) === 'wav'
    case 'audio/mpeg':
      return audioFormat(bytes) === 'mp3'
    case 'text/plain':
    case 'text/markdown':
      if (bytes.includes(0)) return false
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return true
      } catch {
        return false
      }
    default:
      return false
  }
}

/** Contrôle complet d'un fichier téléchargé ; renvoie le motif du refus (court, pour `inbox.error`), ou null. */
export function fileProblem(bytes: Uint8Array, mime: string, declaredSize: number | null): string | null {
  if (!(mime in MIME_EXT)) return 'format refusé'
  if (bytes.length === 0) return 'fichier vide'
  if (bytes.length > FILE_MAX || (mime.startsWith('image/') && bytes.length > IMAGE_MAX)) return 'fichier trop gros'
  if (declaredSize !== null && declaredSize !== bytes.length) return 'taille différente de celle enregistrée'
  if (!matchesSignature(bytes, mime)) return 'contenu ne correspondant pas au format déclaré'
  return null
}

/** Message d'erreur court sur une ligne (colonne `inbox.error`, 300 caractères au plus). */
export function shortError(message: string): string {
  const one = message.replace(/\s+/g, ' ').trim() || 'erreur'
  const arr = Array.from(one)
  return arr.length > ERROR_MAX ? arr.slice(0, ERROR_MAX - 1).join('') + '…' : one
}

export interface InboxCard { front: string; back: string; tags: string[] }
export interface InboxPayload { source_title: string; cards: InboxCard[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`${where} : clé inconnue « ${key} » (attendues : ${allowed.join(', ')})`)
  }
}

const chars = (s: string) => Array.from(s).length

function text(obj: Record<string, unknown>, key: string, max: number, where: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${where} : « ${key} » doit être un texte non vide`)
  const t = v.trim()
  if (t.includes('\u0000')) throw new Error(`${where} : « ${key} » contient un caractère invalide`)
  if (chars(t) > max) throw new Error(`${where} : « ${key} » trop long (${chars(t)} > ${max})`)
  return t
}

/** Clé de doublon : casse, accents, ponctuation et espaces ignorés. */
export function dedupKey(front: string): string {
  return front.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/**
 * JSON produit par l'IA pour un élément : `{source_title, cards: [{front, back, tags}]}`. Mêmes règles que `apply`
 * (texte non vide, longueurs, 1–5 tags libres dédoublonnés, clés inconnues refusées) ; pas d'`id` (cartes
 * toujours nouvelles), 50 cartes au plus, deux questions identiques (doublon) refusées. Liste vide permise : rien à retenir.
 */
export function validateInboxPayload(p: unknown): InboxPayload {
  if (!isRecord(p)) throw new Error('payload invalide : objet JSON attendu')
  rejectUnknownKeys(p, ['source_title', 'cards'], 'payload')
  const source_title = text(p, 'source_title', SOURCE_TITLE_MAX, 'payload')
  if (!Array.isArray(p.cards)) throw new Error('payload : « cards » doit être une liste (éventuellement vide)')
  if (p.cards.length > CARDS_MAX) throw new Error(`payload : ${p.cards.length} cartes, ${CARDS_MAX} au maximum`)
  const seen = new Map<string, number>()
  const cards = p.cards.map((raw: unknown, i: number): InboxCard => {
    const where = `carte ${i + 1}`
    if (!isRecord(raw)) throw new Error(`${where} : objet {front, back, tags} attendu`)
    rejectUnknownKeys(raw, ['front', 'back', 'tags'], where)
    const front = text(raw, 'front', FRONT_MAX, where)
    const back = text(raw, 'back', BACK_MAX, where)
    // Tags libres (#79) : noms existants ou nouveaux ; un nouveau nom n'est créé qu'à la validation du brouillon.
    const tags = requireTagList(raw.tags, where)
    const key = dedupKey(front)
    const twin = seen.get(key)
    if (twin !== undefined) throw new Error(`${where} : doublon de la carte ${twin} (même question)`)
    seen.set(key, i + 1)
    return { front, back, tags }
  })
  return { source_title, cards }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const INBOX_USAGE =
  'usage : node tools/cards/cli.ts inbox list | claim <id> <RUN_DIR> | transcribe <id> <RUN_DIR> | complete <id> <RUN_DIR> | fail <id> <message> | purge'

export type InboxCommand =
  | { action: 'list' }
  | { action: 'purge' }
  | { action: 'claim'; id: string; dir: string }
  | { action: 'transcribe'; id: string; dir: string }
  | { action: 'complete'; id: string; dir: string }
  | { action: 'fail'; id: string; message: string }

/** Arguments après `inbox`. `<RUN_DIR>` : chemin absolu du dossier de l'exécution ; id : UUID. */
export function parseInboxArgs(argv: string[]): InboxCommand {
  const [action, id, arg, ...extra] = argv
  const needId = () => {
    if (!id || !UUID.test(id)) throw new Error(`id invalide (UUID attendu)\n${INBOX_USAGE}`)
    return id
  }
  if (action === 'list' || action === 'purge') {
    if (id !== undefined) throw new Error(INBOX_USAGE)
    return { action }
  }
  if (action === 'claim' || action === 'transcribe' || action === 'complete') {
    const valid = needId()
    if (!arg || !path.isAbsolute(arg) || extra.length) throw new Error(`dossier absolu attendu (RUN_DIR)\n${INBOX_USAGE}`)
    return { action, id: valid, dir: arg }
  }
  if (action === 'fail') {
    const valid = needId()
    const message = [arg, ...extra].filter(s => s !== undefined).join(' ').trim()
    if (!message) throw new Error(`message manquant\n${INBOX_USAGE}`)
    return { action, id: valid, message: shortError(message) }
  }
  throw new Error(INBOX_USAGE)
}

/** Fichier local d'un élément réclamé : nommé par l'id et le type, jamais par le nom fourni par l'utilisateur. */
export function claimPath(dir: string, id: string, kind: 'text' | 'file', mime: string | null): string {
  const ext = kind === 'text' ? 'txt' : MIME_EXT[mime ?? '']
  if (!ext) throw new Error('format refusé')
  return path.join(dir, `${id}.${ext}`)
}

/** 24 h : au-delà, un objet orphelin est purgé et un élément bloqué en `processing` passe en erreur. */
export const STALE_MS = 24 * 60 * 60 * 1000

/** 7 jours : au-delà, un élément jamais traité (`pending`) expire (erreur « expiré ») et libère la limite de 10. */
export const PENDING_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

/** JSON de `complete` : toujours `<RUN_DIR>/<id>.json`, jamais un chemin libre. */
export function payloadPath(dir: string, id: string): string {
  return path.join(dir, `${id}.json`)
}

/**
 * RUN_DIR utilisable : dossier existant dont le chemin réel (liens résolus) est dans le dossier temporaire du système
 * (`mktemp -d`). Renvoie ce chemin réel : claim n'écrit et complete ne lit que dedans.
 */
export async function assertRunDir(dir: string): Promise<string> {
  const st = await fs.stat(dir).catch(() => null)
  if (!st?.isDirectory()) throw new Error(`dossier introuvable : ${dir}`)
  const real = await fs.realpath(dir)
  const tmp = await fs.realpath(os.tmpdir())
  if (!real.startsWith(tmp + path.sep)) throw new Error(`RUN_DIR hors du dossier temporaire du système (mktemp -d attendu) : ${dir}`)
  return real
}

/** Lit le JSON de `complete` : fichier ordinaire (pas de lien), contenu jamais recopié dans un message d'erreur. */
export async function readPayload(file: string): Promise<unknown> {
  const st = await fs.lstat(file).catch(() => null)
  if (!st?.isFile()) throw new Error(`fichier JSON introuvable (ou lien refusé) : ${file}`)
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    throw new Error(`JSON invalide : ${file}`)
  }
}
