import type { supabase } from './supabase'

/**
 * Boîte de réception IA (#55), côté app : dépôt d'un texte collé ou d'un fichier, lecture des statuts.
 * Pipeline : contrôle local (extension, taille) → compression d'une image > 2 Mo (2048 px, JPEG 0,8) → envoi direct
 * vers le bucket privé `inbox/<uid>/<id>` (insertion seule : l'app ne peut ni relire ni lister ni supprimer) →
 * RPC `create_inbox_item`, qui crée l'élément `pending`. Seule la taille est vérifiée sur le fichier stocké ; le type est
 * contraint par la liste blanche du bucket et l'extension.
 * /flashcards (Mac) traite ensuite la file et produit des brouillons (drafts.ts). Réseau obligatoire (pas de file
 * hors ligne pour les fichiers) : erreur `offline` claire.
 * Audio (#48) : même dépôt, sans compression ; le type est normalisé avant l'envoi (le bucket compare le type exact).
 * Limites alignées sur les migrations 20261015010000_inbox, 20261030000000_inbox_audio et tools/cards/inbox.ts.
 */

const MB = 1024 * 1024

export const INBOX_LIMITS = {
  FILE_MAX: 30 * MB,
  IMAGE_MAX: 10 * MB,
  TEXT_MAX: 100_000,
  /** Au-delà, une image est recompressée avant l'envoi. */
  COMPRESS_OVER: 2 * MB,
  MAX_SIDE: 2048,
  JPEG_QUALITY: 0.8,
  /** Éléments en attente (pending + processing) au plus : contrôlé par la RPC. */
  PENDING_MAX: 10,
} as const

export type AudioMime = 'audio/mp4' | 'audio/x-m4a' | 'audio/m4a' | 'audio/webm' | 'audio/wav' | 'audio/x-wav' | 'audio/mpeg'
export type InboxMime = 'application/pdf' | 'text/plain' | 'text/markdown' | 'image/png' | 'image/jpeg' | 'image/webp' | AudioMime

/** Extensions acceptées → type MIME envoyé (l'extension fait foi ; l'outil vérifie ensuite la signature des octets). */
export const ACCEPTED: Readonly<Record<string, InboxMime>> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** Valeur de `accept` pour un `<input type="file">`. */
export const ACCEPT_ATTR = Object.keys(ACCEPTED).map(e => `.${e}`).join(',')

/** Audio (écran Source · Vocal) : extension → type envoyé. L'outil vérifie ensuite la signature des octets. */
export const AUDIO_ACCEPTED: Readonly<Record<string, AudioMime>> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
}

const AUDIO_MIMES: readonly AudioMime[] = ['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg']
/** Variantes rencontrées dans les navigateurs, absentes de la liste du bucket. */
const AUDIO_ALIASES: Readonly<Record<string, AudioMime>> = { 'audio/mp3': 'audio/mpeg', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav' }
const AUDIO_EXT: Readonly<Record<AudioMime, string>> = {
  'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3',
}

/** Valeur de `accept` du champ audio : extensions et types, selon ce que le sélecteur du système sait filtrer. */
export const AUDIO_ACCEPT_ATTR = [...Object.keys(AUDIO_ACCEPTED).map(e => `.${e}`), ...AUDIO_MIMES].join(',')

/** Type tel que le bucket l'accepte : sans paramètre (`audio/webm;codecs=opus` → `audio/webm`), en minuscules ; null s'il n'est pas dans la liste. */
export function normalizeAudioType(type: string): AudioMime | null {
  const base = type.split(';')[0].trim().toLowerCase()
  return AUDIO_ALIASES[base] ?? AUDIO_MIMES.find(m => m === base) ?? null
}

/** Extension d'un fichier audio de ce type (nom d'un enregistrement). */
export const audioExtension = (mime: AudioMime) => AUDIO_EXT[mime]

export type InboxErrorCode = 'offline' | 'empty' | 'too_long' | 'format' | 'too_big' | 'session' | 'full' | 'server'

/** Dépôt refusé ; `code` permet à l'écran d'afficher le bon message. Aucun log. */
export class InboxError extends Error {
  readonly code: InboxErrorCode
  constructor(code: InboxErrorCode, message: string) {
    super(message)
    this.name = 'InboxError'
    this.code = code
  }
}

export type InboxStatus = 'pending' | 'processing' | 'done' | 'error'

/** Élément tel que l'app le lit (sans le texte collé ni le chemin du fichier). */
export interface InboxItem {
  id: string
  kind: 'text' | 'file'
  filename: string | null
  mime: string | null
  size: number | null
  status: InboxStatus
  error: string | null
  created_at: string
  processed_at: string | null
}

export type InboxClient = typeof supabase

const chars = (s: string) => Array.from(s).length

/** Texte collé : trim, non vide, 100 000 caractères au plus. */
export function checkText(text: string): string {
  const t = text.trim()
  if (t === '') throw new InboxError('empty', 'Le texte est vide')
  if (chars(t) > INBOX_LIMITS.TEXT_MAX) throw new InboxError('too_long', `Texte trop long (${chars(t)} > ${INBOX_LIMITS.TEXT_MAX} caractères)`)
  return t
}

const extOf = (name: string) => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

const isImage = (mime: InboxMime) => mime.startsWith('image/')

/** Fichier : extension de la liste, non vide, 30 Mo au plus (une image plus grosse que 10 Mo doit pouvoir être recompressée). */
export function checkFile(file: Pick<File, 'name' | 'size'>): { mime: InboxMime; ext: string } {
  const ext = extOf(file.name)
  const mime = ACCEPTED[ext]
  if (!mime) throw new InboxError('format', 'Format non pris en charge (PDF, texte, Markdown, PNG, JPEG ou WebP)')
  if (file.size <= 0) throw new InboxError('empty', 'Le fichier est vide')
  if (file.size > INBOX_LIMITS.FILE_MAX) throw new InboxError('too_big', 'Fichier trop gros (30 Mo au maximum)')
  return { mime, ext }
}

/** Fichier audio : extension de la liste (sinon le type annoncé, normalisé), non vide, 30 Mo au plus. */
export function checkAudio(file: Pick<File, 'name' | 'size' | 'type'>): AudioMime {
  const mime = AUDIO_ACCEPTED[extOf(file.name)] ?? normalizeAudioType(file.type)
  if (!mime) throw new InboxError('format', 'Format non pris en charge (M4A, MP4, WebM, WAV ou MP3)')
  if (file.size <= 0) throw new InboxError('empty', 'Le fichier est vide')
  if (file.size > INBOX_LIMITS.FILE_MAX) throw new InboxError('too_big', 'Fichier trop gros (30 Mo au maximum)')
  return mime
}

/** Dimensions réduites pour que le plus grand côté tienne dans `max` (jamais d'agrandissement). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Recompresse une image en JPEG, plus grand côté ≤ `maxSide`. */
export type ImageCompressor = (file: Blob, maxSide: number, quality: number) => Promise<Blob>

/** Compression dans le navigateur (createImageBitmap + canvas) : aucune dépendance, aucune requête. */
export const canvasCompressor: ImageCompressor = async (file, maxSide, quality) => {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas indisponible')
    // JPEG n'a pas de transparence : fond blanc d'abord, sinon les zones transparentes d'un PNG deviennent noires.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encodage JPEG impossible'))), 'image/jpeg', quality))
  } finally {
    bitmap.close()
  }
}

const FILENAME_MAX = 255

/**
 * Nom de fichier tel que la RPC l'accepte (sinon refus APRÈS l'envoi, objet orphelin) : caractères de contrôle, `/` et
 * `\` remplacés par une espace, espaces resserrées, 255 caractères au plus en gardant l'extension ; vide → « fichier ».
 * Seulement affiché : le fichier stocké est nommé `<uid>/<id>`.
 */
export function cleanFilename(name: string): string {
  const unsafe = (c: string) => c < ' ' || c === '\u007f' || c === '/' || c === '\\'
  const clean = Array.from(name, c => (unsafe(c) ? ' ' : c)).join('').replace(/\s+/g, ' ').trim()
  const dot = clean.lastIndexOf('.')
  const ext = dot >= 0 ? clean.slice(dot) : ''
  const base = (dot >= 0 ? clean.slice(0, dot) : clean).trim() || 'fichier'
  const room = FILENAME_MAX - Array.from(ext).length
  return Array.from(base).slice(0, Math.max(1, room)).join('').trim() + ext
}

export interface PreparedFile { blob: Blob; filename: string; mime: InboxMime }

/** Contrôle puis, pour une image > 2 Mo, recompression JPEG (nom en .jpg). Une image doit finir à 10 Mo au plus. */
export async function prepareFile(file: File, compress: ImageCompressor = canvasCompressor): Promise<PreparedFile> {
  const { mime } = checkFile(file)
  if (!isImage(mime) || file.size <= INBOX_LIMITS.COMPRESS_OVER) {
    if (isImage(mime) && file.size > INBOX_LIMITS.IMAGE_MAX) throw new InboxError('too_big', 'Image trop grosse (10 Mo au maximum)')
    return { blob: file, filename: cleanFilename(file.name), mime }
  }
  let blob: Blob
  try {
    blob = await compress(file, INBOX_LIMITS.MAX_SIDE, INBOX_LIMITS.JPEG_QUALITY)
  } catch {
    throw new InboxError('format', 'Image illisible : impossible de la préparer')
  }
  if (blob.size > INBOX_LIMITS.IMAGE_MAX) throw new InboxError('too_big', 'Image trop grosse, même compressée (10 Mo au maximum)')
  const base = file.name.slice(0, file.name.lastIndexOf('.'))
  return { blob, filename: cleanFilename(`${base}.jpg`), mime: 'image/jpeg' }
}

export interface InboxDeps {
  client: InboxClient
  online?: () => boolean
  uuid?: () => string
  compress?: ImageCompressor
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine

function requireOnline(online: () => boolean) {
  if (!online()) throw new InboxError('offline', 'Pas de connexion : l’ajout à la boîte de réception nécessite le réseau')
}

const toItem = ({ id, kind, filename, mime, size, status, error, created_at, processed_at }: InboxItem | Record<string, unknown>): InboxItem =>
  ({ id, kind, filename, mime, size, status, error, created_at, processed_at }) as InboxItem

/** Erreur de la RPC → InboxError (quota : 54000 ; paramètre refusé : 22023, message de la base, déjà en français). */
function rpcError(e: { message: string; code?: string }): InboxError {
  if (e.code === '54000') return new InboxError('full', `Boîte de réception pleine (${INBOX_LIMITS.PENDING_MAX} éléments en attente au maximum)`)
  return new InboxError('server', `Ajout refusé : ${e.message}`)
}

/** Dépose un texte collé. Rejette avec InboxError (rien n'est créé). */
export async function addText({ client, online = isOnline, uuid = () => crypto.randomUUID() }: InboxDeps, text: string): Promise<InboxItem> {
  const t = checkText(text)
  requireOnline(online)
  const { data, error } = await client.rpc('create_inbox_item', { p_id: uuid(), p_kind: 'text', p_text: t })
  if (error) throw rpcError(error)
  return toItem(data)
}

async function requireUserId(client: InboxClient): Promise<string> {
  const { data: { session } } = await client.auth.getSession()
  if (!session) throw new InboxError('session', 'Session expirée : se reconnecter')
  return session.user.id
}

/** Message en français pour un refus de Storage, dont le texte brut est en anglais. */
export function uploadErrorMessage(message: string): string {
  if (/mime type/i.test(message)) return 'Envoi du fichier refusé : format non accepté par le serveur'
  if (/exceeded|too large|maximum/i.test(message)) return 'Envoi du fichier refusé : fichier trop gros (30 Mo au maximum)'
  return 'Envoi du fichier refusé : réessaie plus tard'
}

/** Envoi vers `inbox/<uid>/<id>` (sans écrasement) puis création de l'élément. */
async function deposit({ client, uuid = () => crypto.randomUUID() }: InboxDeps, uid: string, { blob, filename, mime }: PreparedFile): Promise<InboxItem> {
  const id = uuid()
  // Storage ignore `contentType` pour un Blob/File (envoi en FormData) et prend le type du corps, souvent vide pour un .md
  // sur Safari/iOS : le corps est réemballé avec le type déduit (sans copie du contenu).
  const body = new Blob([blob], { type: mime })
  const up = await client.storage.from('inbox').upload(`${uid}/${id}`, body, { contentType: mime, upsert: false })
  if (up.error) throw new InboxError('server', uploadErrorMessage(up.error.message))
  const { data, error } = await client.rpc('create_inbox_item', { p_id: id, p_kind: 'file', p_filename: filename })
  if (error) throw rpcError(error)
  return toItem(data)
}

/**
 * Dépose un fichier : envoi puis création de l'élément. Si la création échoue après l'envoi, le fichier orphelin est
 * purgé par l'outil (`inbox purge`, après 24 h).
 */
export async function addFile(deps: InboxDeps, file: File): Promise<InboxItem> {
  const { client, online = isOnline, compress } = deps
  checkFile(file)
  requireOnline(online)
  const uid = await requireUserId(client)
  return deposit(deps, uid, await prepareFile(file, compress))
}

/** Dépose un audio (enregistré ou importé), tel quel, avec son type normalisé. Mêmes garanties que addFile. */
export async function addAudio(deps: InboxDeps, file: File): Promise<InboxItem> {
  const { client, online = isOnline } = deps
  const mime = checkAudio(file)
  requireOnline(online)
  const uid = await requireUserId(client)
  // File pleine : on l'annonce avant d'envoyer jusqu'à 30 Mo pour rien. La RPC reste juge ; une lecture ratée ne bloque pas.
  const items = await listInbox(client).catch(() => [])
  if (items.filter(i => i.status === 'pending' || i.status === 'processing').length >= INBOX_LIMITS.PENDING_MAX) {
    throw new InboxError('full', `Boîte de réception pleine (${INBOX_LIMITS.PENDING_MAX} éléments en attente au maximum)`)
  }
  return deposit(deps, uid, { blob: file, filename: cleanFilename(file.name), mime })
}

/** Les 50 derniers éléments (statuts), du plus récent au plus ancien. Réseau requis. */
export async function listInbox(client: InboxClient): Promise<InboxItem[]> {
  const { data, error } = await client.from('inbox')
    .select('id, kind, filename, mime, size, status, error, created_at, processed_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new InboxError('server', `Lecture de la boîte de réception impossible : ${error.message}`)
  return (data ?? []).map(toItem)
}
