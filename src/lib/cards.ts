import { MAX_TAGS, cleanTagNames } from '../../shared/tags'
import type { VaultDB } from './db'
import type { Card } from './types'

/**
 * Cartes créées à la main (#54) : écrites tout de suite dans le cache local (hors ligne d'abord), marquées
 * `synced: 0`, puis envoyées par la file « cartes » de la synchro (sync.ts, avant les reviews).
 * Mêmes règles que la base (migration 20261015000000_manual_cards) : question 1–500 caractères, réponse 1–1500,
 * 1 à 5 tags libres (#79 : noms normalisés, 1–40 caractères, doublons de casse retirés ; le 1er est le principal).
 * Un nom nouveau devient un tag côté serveur à l'envoi (trigger). Aucune IA, aucune écriture serveur directe.
 */

export const FRONT_MAX = 500
export const BACK_MAX = 1500

export interface ManualCardInput {
  front: string
  back: string
  tags: readonly string[]
}

export type ManualCardField = keyof ManualCardInput

/** Saisie refusée ; `field` désigne le champ à signaler dans le formulaire. */
export class CardValidationError extends Error {
  readonly field: ManualCardField
  constructor(field: ManualCardField, message: string) {
    super(message)
    this.name = 'CardValidationError'
    this.field = field
  }
}

/** Longueur en caractères (points de code), comme `length()` / `char_length()` en SQL : un emoji compte pour 1. */
const chars = (s: string) => Array.from(s).length

/**
 * Texte que Postgres refuserait (erreur 400 à chaque envoi) : caractère NUL (interdit dans `text`) ou surrogate UTF-16
 * isolé (pas de point de code valide, donc pas d'UTF-8). Les paires complètes (emojis) passent.
 */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const unstorable = (s: string) => s.includes('\u0000') || LONE_SURROGATE.test(s)

function text(field: 'front' | 'back', value: string, max: number, label: string): string {
  const v = value.trim()
  if (v === '') throw new CardValidationError(field, `${label} est vide`)
  if (unstorable(v)) throw new CardValidationError(field, `${label} contient un caractère invalide`)
  if (chars(v) > max) throw new CardValidationError(field, `${label} est trop longue (${chars(v)} > ${max} caractères)`)
  return v
}

function tagList(tags: readonly string[], minTags: number): string[] {
  let names: string[]
  try {
    names = cleanTagNames(tags)
  } catch (e) {
    throw new CardValidationError('tags', (e as Error).message)
  }
  if (names.length < minTags) throw new CardValidationError('tags', minTags === 1 ? 'choisir au moins 1 tag' : `choisir au moins ${minTags} tags`)
  if (names.length > MAX_TAGS) throw new CardValidationError('tags', `${MAX_TAGS} tags au maximum`)
  return names
}

/**
 * Valide et normalise (trim) une saisie ; lève CardValidationError sur le premier champ invalide. `minTags` : 1 pour
 * une carte manuelle ou de la boîte de réception (contraintes SQL), 0 pour une carte du vault (elle peut n'en avoir aucun).
 */
export function validateManualCard(input: ManualCardInput, minTags = 1): ManualCardInput & { tags: string[] } {
  return {
    front: text('front', input.front, FRONT_MAX, 'La question'),
    back: text('back', input.back, BACK_MAX, 'La réponse'),
    tags: tagList(input.tags, minTags),
  }
}

export interface WriteOptions {
  now?: () => Date
  uuid?: () => string
}

/** Crée une carte manuelle dans le cache local (visible aussitôt dans les sessions et compteurs), à envoyer. */
export async function createManualCard(db: VaultDB, input: ManualCardInput, { now = () => new Date(), uuid = () => crypto.randomUUID() }: WriteOptions = {}): Promise<Card> {
  const at = now().toISOString()
  const card: Card = {
    id: uuid(),
    source: 'manual',
    deck: null,
    source_path: null,
    source_title: null,
    ...validateManualCard(input),
    created_at: at,
    updated_at: at,
    deleted_at: null,
    synced: 0,
  }
  await db.cards.add(card)
  return card
}

/** Carte manuelle vivante, ou erreur. */
async function liveManual(db: VaultDB, id: string): Promise<Card> {
  const card = await db.cards.get(id)
  if (!card || card.source !== 'manual' || card.deleted_at !== null) throw new Error(`carte manuelle introuvable : ${id}`)
  return card
}

/**
 * Modifie question, réponse et/ou tags d'une carte vivante et active, quelle que soit son origine (#79, décision #73 :
 * y compris une carte du vault, que /flashcards pourra réécrire ; un brouillon passe par drafts.ts). Progression
 * conservée (même id). La carte est marquée à envoyer : UPDATE seul pour vault/inbox (sync.ts).
 */
export async function updateCard(db: VaultDB, id: string, patch: Partial<ManualCardInput>, { now = () => new Date() }: Pick<WriteOptions, 'now'> = {}): Promise<Card> {
  return db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(id)
    if (!card || card.deleted_at !== null || card.status === 'draft') throw new Error(`carte introuvable : ${id}`)
    const next: Card = {
      ...card,
      ...validateManualCard({ front: patch.front ?? card.front, back: patch.back ?? card.back, tags: patch.tags ?? card.tags }, card.source === 'vault' ? 0 : 1),
      updated_at: now().toISOString(),
      synced: 0,
    }
    await db.cards.put(next)
    return next
  })
}

/**
 * Suppression douce d'une carte manuelle : `deleted_at` posé, la carte sort des sessions et des compteurs ; ses
 * reviews restent (journal en ajout seul). Déjà supprimée : sans effet.
 */
export async function deleteManualCard(db: VaultDB, id: string, { now = () => new Date() }: Pick<WriteOptions, 'now'> = {}): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(id)
    if (card?.source === 'manual' && card.deleted_at !== null) return
    await liveManual(db, id)
    const at = now().toISOString()
    await db.cards.update(id, { deleted_at: at, updated_at: at, synced: 0 })
  })
}

/**
 * Suppression douce d'une carte vivante et active, quelle que soit son origine (#73 : vault, manual, inbox validée ;
 * un brouillon se rejette par drafts.ts) : `deleted_at` posé, la carte sort des sessions et des compteurs, ses reviews
 * restent. Envoyée par la synchro (UPDATE de deleted_at seul pour vault/inbox). Déjà supprimée : sans effet.
 */
export async function deleteCard(db: VaultDB, id: string, { now = () => new Date() }: Pick<WriteOptions, 'now'> = {}): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    const card = await db.cards.get(id)
    if (card && card.deleted_at !== null) return
    if (!card || card.status === 'draft') throw new Error(`carte introuvable : ${id}`)
    const at = now().toISOString()
    await db.cards.update(id, { deleted_at: at, updated_at: at, synced: 0 })
  })
}
