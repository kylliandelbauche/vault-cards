import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MAX_TAGS, isTagSlug } from '../../shared/tags.ts'

export interface NoteFile { source_path: string; deck: string; content_hash: string; abs_path: string }
export interface IncomingCard { id?: string; front: string; back: string; tags: string[] }
export interface ApplyPayload { source_path: string; deck: string; content_hash: string; cards: IncomingCard[] }
export interface ExistingCard { id: string; front: string; back: string; tags: string[] }
export interface RetagEntry { id: string; tags: string[] }
export interface RetagTarget extends RetagEntry { deleted_at: string | null }
export interface NoteRow { source_path: string; content_hash: string }

/** Hash stocké dans `notes` pour une note supprimée du vault (ses cartes sont supprimées). */
export const REMOVED_HASH = 'removed'

const FRONT_MAX = 500
const BACK_MAX = 1500

/** Chemin relatif en `/`, normalisé NFC (APFS conserve la forme écrite, la base doit rester stable). */
function toPosix(rel: string): string {
  return rel.split(path.sep).join('/').normalize('NFC')
}

export async function listSyntheses(vaultRoot: string, subdir = '3-Resources/veille'): Promise<NoteFile[]> {
  const base = path.join(vaultRoot, subdir)
  const entries = await fs.readdir(base, { recursive: true, withFileTypes: true })
  const notes: NoteFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('-synthese.md')) continue
    const abs_path = path.join(entry.parentPath, entry.name)
    const inSubdir = toPosix(path.relative(base, abs_path)).split('/')
    if (inSubdir.length < 2) continue // fichier directement dans subdir : pas de deck
    const content = await fs.readFile(abs_path, 'utf8')
    notes.push({
      source_path: toPosix(path.relative(vaultRoot, abs_path)),
      deck: inSubdir[0],
      content_hash: hashContent(content),
      abs_path,
    })
  }
  return notes.sort((a, b) => a.source_path.localeCompare(b.source_path))
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function diffCards(existing: ExistingCard[], incoming: IncomingCard[]): {
  toInsert: IncomingCard[]; toUpdate: ExistingCard[]; toDelete: string[]
} {
  const byId = new Map(existing.map(c => [c.id, c]))
  const kept = new Set<string>()
  const toInsert: IncomingCard[] = []
  const toUpdate: ExistingCard[] = []
  for (const card of incoming) {
    if (card.id === undefined) {
      toInsert.push({ front: card.front, back: card.back, tags: card.tags })
      continue
    }
    const current = byId.get(card.id)
    if (!current) throw new Error('id inconnu: ' + card.id)
    if (kept.has(card.id)) throw new Error('id en double: ' + card.id)
    kept.add(card.id)
    if (current.front !== card.front || current.back !== card.back || !sameTags(current.tags, card.tags)) {
      toUpdate.push({ id: card.id, front: card.front, back: card.back, tags: card.tags })
    }
  }
  const toDelete = existing.filter(c => !kept.has(c.id)).map(c => c.id)
  return { toInsert, toUpdate, toDelete }
}

/** L'ordre compte : le 1er tag est le tag principal. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i])
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireText(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${where} : « ${key} » doit être un texte non vide`)
  return v.trim()
}

/** 1 à MAX_TAGS slugs connus, sans doublon (shared/tags.ts). */
function requireTags(obj: Record<string, unknown>, where: string): string[] {
  const v = obj.tags
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_TAGS) {
    throw new Error(`${where} : « tags » doit être une liste de 1 à ${MAX_TAGS} tags`)
  }
  for (const t of v) {
    if (!isTagSlug(t)) throw new Error(`${where} : tag inconnu « ${String(t)} »`)
  }
  if (new Set(v).size !== v.length) throw new Error(`${where} : tag en double`)
  return [...v] as string[]
}

/** Une faute de frappe (`ID` au lieu de `id`) ferait traiter la carte comme nouvelle et perdre sa progression. */
function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`${where} : clé inconnue « ${key} » (attendues : ${allowed.join(', ')})`)
  }
}

export function validatePayload(p: unknown): ApplyPayload {
  if (!isRecord(p)) throw new Error('payload invalide : objet JSON attendu')
  rejectUnknownKeys(p, ['source_path', 'deck', 'content_hash', 'cards'], 'payload')
  const source_path = requireText(p, 'source_path', 'payload')
  const deck = requireText(p, 'deck', 'payload')
  const content_hash = requireText(p, 'content_hash', 'payload')
  if (!Array.isArray(p.cards)) throw new Error('payload : « cards » doit être une liste (éventuellement vide)')
  const cards = p.cards.map((raw: unknown, i: number): IncomingCard => {
    const where = `carte ${i + 1}`
    if (!isRecord(raw)) throw new Error(`${where} : objet {front, back} attendu`)
    rejectUnknownKeys(raw, ['id', 'front', 'back', 'tags'], where)
    const front = requireText(raw, 'front', where)
    const back = requireText(raw, 'back', where)
    if (front.length > FRONT_MAX) throw new Error(`${where} : question trop longue (${front.length} > ${FRONT_MAX})`)
    if (back.length > BACK_MAX) throw new Error(`${where} : réponse trop longue (${back.length} > ${BACK_MAX})`)
    const tags = requireTags(raw, where)
    if (raw.id === undefined) return { front, back, tags }
    if (typeof raw.id !== 'string' || raw.id === '') throw new Error(`${where} : « id » doit être un texte (ou absent)`)
    return { id: raw.id, front, back, tags }
  })
  return { source_path, deck, content_hash, cards }
}

/** Protection en profondeur : supprimer les cartes d'une note (payload `removed`) exige un flag explicite, posé après confirmation de Kyllian. */
export function assertDeleteConfirmed(payload: Pick<ApplyPayload, 'source_path' | 'content_hash'>, confirmed: boolean): void {
  if (payload.content_hash === REMOVED_HASH && !confirmed) {
    throw new Error(
      `suppression refusée pour ${payload.source_path} : ajouter --confirm-delete, uniquement après confirmation explicite de Kyllian`,
    )
  }
}

/** Nombre de cartes vivantes par note `removed` (rows = cartes vivantes de ces notes), pour les présenter avant suppression. */
export function countLiveCards(removed: string[], liveRows: { source_path: string }[]): { source_path: string; live_cards: number }[] {
  const counts = new Map<string, number>()
  for (const r of liveRows) counts.set(r.source_path, (counts.get(r.source_path) ?? 0) + 1)
  return removed.map(source_path => ({ source_path, live_cards: counts.get(source_path) ?? 0 }))
}

/**
 * Le hash du payload doit être celui du fichier tel qu'il est maintenant (même fonction que `scan`) :
 * sinon les cartes ont été écrites pour une autre version de la note, ou le payload est un vieux fichier rejoué.
 * Non applicable à REMOVED_HASH (le fichier n'existe plus).
 */
export function assertContentHashFresh(declared: string, currentContent: string): void {
  if (declared !== hashContent(currentContent)) throw new Error('note modifiée depuis le scan, relancer scan')
}

/**
 * `deck` doit être le dossier qui suit `veille/` dans `source_path` (comme dans `scan`) :
 * un deck erroné rangerait les cartes dans le mauvais paquet.
 */
export function assertDeckMatchesPath(source_path: string, deck: string): void {
  const parts = source_path.split('/')
  const i = parts.indexOf('veille')
  // Il faut au moins un dossier de deck puis un fichier après `veille/`.
  if (i === -1 || parts.length < i + 3) {
    throw new Error(`source_path « ${source_path} » : attendu …/veille/<deck>/…/<note>`)
  }
  if (parts[i + 1] !== deck) {
    throw new Error(`deck « ${deck} » incohérent avec source_path « ${source_path} » : attendu « ${parts[i + 1]} »`)
  }
}

/** Fichier de `retag` : liste de {id, tags}. Tout autre champ est ignoré (le texte n'est jamais modifié). */
export function validateRetagPayload(p: unknown): RetagEntry[] {
  if (!Array.isArray(p)) throw new Error('retag : liste JSON de {id, tags} attendue')
  const seen = new Set<string>()
  return p.map((raw: unknown, i: number): RetagEntry => {
    const where = `entrée ${i + 1}`
    if (!isRecord(raw)) throw new Error(`${where} : objet {id, tags} attendu`)
    const id = requireText(raw, 'id', where)
    if (seen.has(id)) throw new Error('id en double: ' + id)
    seen.add(id)
    return { id, tags: requireTags(raw, where) }
  })
}

/**
 * Compare aux cartes en base (vivantes ou supprimées) : id inconnu ou carte supprimée = erreur
 * (rien n'est écrit), tags identiques = ignorés.
 */
export function planRetag(existing: RetagTarget[], entries: RetagEntry[]): { toUpdate: RetagEntry[]; unchanged: number } {
  const byId = new Map(existing.map(c => [c.id, c]))
  const toUpdate: RetagEntry[] = []
  let unchanged = 0
  for (const e of entries) {
    const current = byId.get(e.id)
    if (!current) throw new Error('id inconnu: ' + e.id)
    if (current.deleted_at !== null) throw new Error('carte supprimée: ' + e.id)
    if (sameTags(current.tags, e.tags)) unchanged++
    else toUpdate.push(e)
  }
  return { toUpdate, unchanged }
}

/** changed = notes nouvelles ou modifiées ; removed = notes en base absentes du disque (pas déjà marquées removed). */
export function computeScan(files: NoteFile[], rows: NoteRow[]): { changed: NoteFile[]; removed: string[] } {
  const stored = new Map(rows.map(r => [r.source_path, r.content_hash]))
  const onDisk = new Set(files.map(f => f.source_path))
  const changed = files.filter(f => stored.get(f.source_path) !== f.content_hash)
  const removed = rows
    .filter(r => !onDisk.has(r.source_path) && r.content_hash !== REMOVED_HASH)
    .map(r => r.source_path)
    .sort()
  return { changed, removed }
}
