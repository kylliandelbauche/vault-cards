import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface NoteFile { source_path: string; deck: string; content_hash: string; abs_path: string }
export interface IncomingCard { id?: string; front: string; back: string }
export interface ApplyPayload { source_path: string; deck: string; content_hash: string; cards: IncomingCard[] }
export interface ExistingCard { id: string; front: string; back: string }
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
      toInsert.push({ front: card.front, back: card.back })
      continue
    }
    const current = byId.get(card.id)
    if (!current) throw new Error('id inconnu: ' + card.id)
    if (kept.has(card.id)) throw new Error('id en double: ' + card.id)
    kept.add(card.id)
    if (current.front !== card.front || current.back !== card.back) {
      toUpdate.push({ id: card.id, front: card.front, back: card.back })
    }
  }
  const toDelete = existing.filter(c => !kept.has(c.id)).map(c => c.id)
  return { toInsert, toUpdate, toDelete }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireText(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${where} : « ${key} » doit être un texte non vide`)
  return v.trim()
}

export function validatePayload(p: unknown): ApplyPayload {
  if (!isRecord(p)) throw new Error('payload invalide : objet JSON attendu')
  const source_path = requireText(p, 'source_path', 'payload')
  const deck = requireText(p, 'deck', 'payload')
  const content_hash = requireText(p, 'content_hash', 'payload')
  if (!Array.isArray(p.cards)) throw new Error('payload : « cards » doit être une liste (éventuellement vide)')
  const cards = p.cards.map((raw: unknown, i: number): IncomingCard => {
    const where = `carte ${i + 1}`
    if (!isRecord(raw)) throw new Error(`${where} : objet {front, back} attendu`)
    const front = requireText(raw, 'front', where)
    const back = requireText(raw, 'back', where)
    if (front.length > FRONT_MAX) throw new Error(`${where} : question trop longue (${front.length} > ${FRONT_MAX})`)
    if (back.length > BACK_MAX) throw new Error(`${where} : réponse trop longue (${back.length} > ${BACK_MAX})`)
    if (raw.id === undefined) return { front, back }
    if (typeof raw.id !== 'string' || raw.id === '') throw new Error(`${where} : « id » doit être un texte (ou absent)`)
    return { id: raw.id, front, back }
  })
  return { source_path, deck, content_hash, cards }
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
