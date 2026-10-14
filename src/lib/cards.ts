import { MAX_TAGS, isTagSlug } from '../../shared/tags'
import type { VaultDB } from './db'
import type { Card } from './types'

/**
 * Cartes créées à la main (#54) : écrites tout de suite dans le cache local (hors ligne d'abord), marquées
 * `synced: 0`, puis envoyées par la file « cartes » de la synchro (sync.ts, avant les reviews).
 * Mêmes règles que la base (migration 20261015000000_manual_cards) : question 1–500 caractères, réponse 1–1500,
 * 1 à 2 tags de shared/tags.ts sans doublon (le 1er est le principal). Aucune IA, aucune écriture serveur directe.
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

function tagList(tags: readonly string[]): string[] {
  if (tags.length < 1 || tags.length > MAX_TAGS) throw new CardValidationError('tags', `choisir 1 à ${MAX_TAGS} tags`)
  for (const t of tags) if (!isTagSlug(t)) throw new CardValidationError('tags', `tag inconnu « ${t} »`)
  if (new Set(tags).size !== tags.length) throw new CardValidationError('tags', 'tag en double')
  return [...tags]
}

/** Valide et normalise (trim) une saisie ; lève CardValidationError sur le premier champ invalide. */
export function validateManualCard(input: ManualCardInput): ManualCardInput & { tags: string[] } {
  return {
    front: text('front', input.front, FRONT_MAX, 'La question'),
    back: text('back', input.back, BACK_MAX, 'La réponse'),
    tags: tagList(input.tags),
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

/** Carte manuelle vivante, ou erreur (une carte vault n'est jamais modifiable depuis l'app). */
async function liveManual(db: VaultDB, id: string): Promise<Card> {
  const card = await db.cards.get(id)
  if (!card || card.source !== 'manual' || card.deleted_at !== null) throw new Error(`carte manuelle introuvable : ${id}`)
  return card
}

/** Modifie question, réponse et/ou tags d'une carte manuelle (progression conservée : même id), à envoyer. */
export async function updateManualCard(db: VaultDB, id: string, patch: Partial<ManualCardInput>, { now = () => new Date() }: Pick<WriteOptions, 'now'> = {}): Promise<Card> {
  return db.transaction('rw', db.cards, async () => {
    const card = await liveManual(db, id)
    const next: Card = {
      ...card,
      ...validateManualCard({ front: patch.front ?? card.front, back: patch.back ?? card.back, tags: patch.tags ?? card.tags }),
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
