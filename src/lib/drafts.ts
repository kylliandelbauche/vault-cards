import { validateManualCard, type ManualCardInput, type WriteOptions } from './cards'
import type { VaultDB } from './db'
import type { Card } from './types'

/**
 * Brouillons de la boîte de réception (#55) : cartes proposées par /flashcards (`source = 'inbox'`, `status = 'draft'`),
 * tirées du serveur par la synchro. Exclus des sessions, compteurs et tags (session.ts, `isLive`) tant qu'ils ne sont
 * pas acceptés. Chaque action écrit d'abord dans le cache local (hors ligne compris), marque la carte `synced: 0`,
 * puis la file « cartes » de la synchro l'envoie (UPDATE seul : front, back, tags, deleted_at, status).
 * Mêmes règles de contenu qu'une carte manuelle (validateManualCard). Une carte acceptée ne redevient jamais brouillon.
 */

type Now = Pick<WriteOptions, 'now'>

const isDraft = (c: Card | undefined): c is Card =>
  c !== undefined && c.source === 'inbox' && c.status === 'draft' && c.deleted_at === null

async function liveDraft(db: VaultDB, id: string): Promise<Card> {
  const card = await db.cards.get(id)
  if (!isDraft(card)) throw new Error(`brouillon introuvable : ${id}`)
  return card
}

const byCreation = (a: Card, b: Card) => (a.created_at ?? '').localeCompare(b.created_at ?? '') || a.id.localeCompare(b.id)

/** Brouillons vivants (d'un élément de la boîte de réception, ou tous), dans l'ordre de création. */
export async function listDrafts(db: VaultDB, inboxId?: string): Promise<Card[]> {
  const rows = inboxId === undefined
    ? await db.cards.filter(isDraft).toArray()
    : await db.cards.where('inbox_id').equals(inboxId).filter(isDraft).toArray()
  return rows.sort(byCreation)
}

function edited(card: Card, patch: Partial<ManualCardInput> | undefined, at: string): Card {
  return {
    ...card,
    ...validateManualCard({ front: patch?.front ?? card.front, back: patch?.back ?? card.back, tags: patch?.tags ?? card.tags }),
    updated_at: at,
    synced: 0,
  }
}

/** Retouche un brouillon sans l'accepter (question, réponse, tags). Lève CardValidationError si invalide. */
export async function updateDraft(db: VaultDB, id: string, patch: Partial<ManualCardInput>, { now = () => new Date() }: Now = {}): Promise<Card> {
  return db.transaction('rw', db.cards, async () => {
    const next = edited(await liveDraft(db, id), patch, now().toISOString())
    await db.cards.put(next)
    return next
  })
}

/** Accepte un brouillon, éventuellement retouché : il devient une carte active (sessions, compteurs, tags). */
export async function acceptDraft(db: VaultDB, id: string, patch?: Partial<ManualCardInput>, { now = () => new Date() }: Now = {}): Promise<Card> {
  return db.transaction('rw', db.cards, async () => {
    const next: Card = { ...edited(await liveDraft(db, id), patch, now().toISOString()), status: 'active' }
    await db.cards.put(next)
    return next
  })
}

/** Rejette un brouillon : suppression douce (aucune suppression physique n'est permise à l'app). */
export async function rejectDraft(db: VaultDB, id: string, { now = () => new Date() }: Now = {}): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    await liveDraft(db, id)
    const at = now().toISOString()
    await db.cards.update(id, { deleted_at: at, updated_at: at, synced: 0 })
  })
}

/** « Tout accepter » : tous les brouillons vivants (d'un élément, ou tous) passent en active, sans retouche. Renvoie leur nombre. */
export async function acceptAll(db: VaultDB, inboxId?: string, { now = () => new Date() }: Now = {}): Promise<number> {
  return db.transaction('rw', db.cards, async () => {
    const drafts = await listDrafts(db, inboxId)
    const at = now().toISOString()
    await db.cards.bulkUpdate(drafts.map(c => ({ key: c.id, changes: { status: 'active' as const, updated_at: at, synced: 0 as const } })))
    return drafts.length
  })
}
