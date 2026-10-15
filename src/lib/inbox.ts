import type { supabase } from './supabase'

/**
 * Boîte de réception IA (#55), côté app : dépôt d'un texte collé ou d'un fichier, lecture des statuts.
 * Pipeline : contrôle local (extension, taille) → compression d'une image > 2 Mo (2048 px, JPEG 0,8) → envoi direct
 * vers le bucket privé `inbox/<uid>/<id>` (insertion seule : l'app ne peut ni relire ni lister ni supprimer) →
 * RPC `create_inbox_item`, qui crée l'élément `pending`. Seule la taille est vérifiée sur le fichier stocké ; le type est
 * contraint par la liste blanche du bucket et l'extension.
 * /flashcards (Mac) traite ensuite la file et produit des brouillons (drafts.ts). Réseau obligatoire (pas de file
 * hors ligne pour les fichiers) : erreur `offline` claire.
 * Limites alignées sur la migration 20261015010000_inbox et tools/cards/inbox.ts.
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

export type InboxMime = 'application/pdf' | 'text/plain' | 'text/markdown' | 'image/png' | 'image/jpeg' | 'image/webp'

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
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encodage JPEG impossible'))), 'image/jpeg', quality))
  } finally {
    bitmap.close()
  }
}

export interface PreparedFile { blob: Blob; filename: string; mime: InboxMime }

/** Contrôle puis, pour une image > 2 Mo, recompression JPEG (nom en .jpg). Une image doit finir à 10 Mo au plus. */
export async function prepareFile(file: File, compress: ImageCompressor = canvasCompressor): Promise<PreparedFile> {
  const { mime } = checkFile(file)
  if (!isImage(mime) || file.size <= INBOX_LIMITS.COMPRESS_OVER) {
    if (isImage(mime) && file.size > INBOX_LIMITS.IMAGE_MAX) throw new InboxError('too_big', 'Image trop grosse (10 Mo au maximum)')
    return { blob: file, filename: file.name, mime }
  }
  let blob: Blob
  try {
    blob = await compress(file, INBOX_LIMITS.MAX_SIDE, INBOX_LIMITS.JPEG_QUALITY)
  } catch {
    throw new InboxError('format', 'Image illisible : impossible de la préparer')
  }
  if (blob.size > INBOX_LIMITS.IMAGE_MAX) throw new InboxError('too_big', 'Image trop grosse, même compressée (10 Mo au maximum)')
  const base = file.name.slice(0, file.name.lastIndexOf('.'))
  return { blob, filename: `${base}.jpg`, mime: 'image/jpeg' }
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

/**
 * Dépose un fichier : envoi vers `inbox/<uid>/<id>` (sans écrasement) puis création de l'élément. Si la création échoue
 * après l'envoi, le fichier orphelin est purgé par l'outil (`inbox purge`, après 24 h).
 */
export async function addFile({ client, online = isOnline, uuid = () => crypto.randomUUID(), compress }: InboxDeps, file: File): Promise<InboxItem> {
  checkFile(file)
  requireOnline(online)
  const { data: { session } } = await client.auth.getSession()
  if (!session) throw new InboxError('session', 'Session expirée : se reconnecter')
  const prepared = await prepareFile(file, compress)
  const id = uuid()
  // Storage ignore `contentType` pour un Blob/File (envoi en FormData) et prend le type du corps, souvent vide pour un .md
  // sur Safari/iOS : le corps est réemballé avec le type déduit de l'extension (sans copie du contenu).
  const body = new Blob([prepared.blob], { type: prepared.mime })
  const up = await client.storage.from('inbox').upload(`${session.user.id}/${id}`, body, { contentType: prepared.mime, upsert: false })
  if (up.error) throw new InboxError('server', `Envoi du fichier refusé : ${up.error.message}`)
  const { data, error } = await client.rpc('create_inbox_item', { p_id: id, p_kind: 'file', p_filename: prepared.filename })
  if (error) throw rpcError(error)
  return toItem(data)
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
