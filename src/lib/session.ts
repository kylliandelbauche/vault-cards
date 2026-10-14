import { State } from 'ts-fsrs'
import { stateFromReviews, isNew, type FsrsCard } from './scheduler'
import type { Card, Review } from './types'

export interface SessionItem { card: Card; state: FsrsCard }

/** Nombre maximal de nouvelles cartes introduites par jour (quota global, tous tags confondus). */
export const NEW_PER_DAY = 20

const sameLocalDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

export function byCard(reviews: Review[]) {
  const m = new Map<string, Review[]>()
  for (const r of reviews) m.set(r.card_id, [...(m.get(r.card_id) ?? []), r])
  return m
}

/** La carte porte ce tag (doublon ou `tags` absent d'un vieux cache : sans effet). */
export const hasTag = (card: Card, tag: string) => (card.tags ?? []).includes(tag)

/** Cartes vivantes (non supprimées) avec leur état FSRS, recalculé depuis l'historique. */
export function scheduleItems(cards: Card[], grouped: Map<string, Review[]>): SessionItem[] {
  return cards.filter(c => !c.deleted_at).map(card => ({ card, state: stateFromReviews(grouped.get(card.id) ?? []) }))
}

/**
 * Cartes introduites aujourd'hui (jour local), toutes cartes confondues : première note aujourd'hui, donnée
 * hors révision libre (une nouvelle découverte en « Réviser à nouveau » ne consomme pas le quota).
 */
function introducedToday(grouped: Map<string, Review[]>, now: Date) {
  return [...grouped.values()].filter(rs => {
    const first = rs.reduce((a, b) => (a.reviewed_at < b.reviewed_at ? a : b))
    return !first.free && sameLocalDay(new Date(first.reviewed_at), now)
  }).length
}

/**
 * Ordre des nouvelles cartes. Cartes manuelles (#54) d'abord (pas de source_path : créées exprès pour être apprises),
 * dans l'ordre de création (leur id est un UUID aléatoire) ; puis cartes du vault par note, puis id.
 */
function freshOrder({ card: a }: SessionItem, { card: b }: SessionItem) {
  const byPath = (a.source_path ?? '').localeCompare(b.source_path ?? '')
  if (byPath) return byPath
  const byCreation = a.source === 'manual' && b.source === 'manual' ? (a.created_at ?? '').localeCompare(b.created_at ?? '') : 0
  return byCreation || a.id.localeCompare(b.id)
}

/**
 * File du jour à partir d'éléments déjà planifiés : dues (échéance la plus ancienne d'abord), puis nouvelles
 * dans la limite du quota restant. Avec `tag`, seules les cartes du tag ; le quota reste global
 * (les nouvelles déjà vues aujourd'hui, tous tags confondus, sont décomptées).
 */
export function queueOf(items: SessionItem[], grouped: Map<string, Review[]>, now: Date, newLimit = NEW_PER_DAY, tag?: string): SessionItem[] {
  const scoped = tag === undefined ? items : items.filter(i => hasTag(i.card, tag))
  const due = scoped.filter(i => !isNew(i.state) && i.state.due <= now)
    .sort((a, b) => a.state.due.getTime() - b.state.due.getTime())
  const fresh = scoped.filter(i => isNew(i.state))
    .sort(freshOrder)
    .slice(0, Math.max(0, newLimit - introducedToday(grouped, now)))
  return [...due, ...fresh]
}

/** Session normale : cartes dues + nouvelles du jour (quota global), éventuellement limitée à un tag. */
export function buildQueue(cards: Card[], reviews: Review[], now: Date, newLimit = NEW_PER_DAY, tag?: string): SessionItem[] {
  const grouped = byCard(reviews)
  return queueOf(scheduleItems(cards, grouped), grouped, now, newLimit, tag)
}

/**
 * Révision libre (« Réviser à nouveau ») : toutes les cartes vivantes (du tag, s'il y en a un), dues ou non,
 * sans limite de nouvelles. Cartes déjà vues d'abord (échéance la plus proche), puis nouvelles dans l'ordre habituel.
 * FSRS gère une révision anticipée via le temps écoulé depuis la précédente.
 */
export function freeQueue(cards: Card[], reviews: Review[], now: Date, tag?: string): SessionItem[] {
  const grouped = byCard(reviews)
  const items = scheduleItems(cards, grouped).filter(i => tag === undefined || hasTag(i.card, tag))
  const seen = items.filter(i => !isNew(i.state)).sort((a, b) => a.state.due.getTime() - b.state.due.getTime())
  const fresh = queueOf(items.filter(i => isNew(i.state)), new Map(), now, Infinity)
  return [...seen, ...fresh]
}

export function countKinds(items: SessionItem[]) {
  let n = 0, learn = 0, due = 0
  for (const { state } of items) {
    if (state.state === State.New) n++
    else if (state.state === State.Learning || state.state === State.Relearning) learn++
    else due++
  }
  return { new: n, learn, due }
}

export function nextDue(cards: Card[], reviews: Review[], now: Date, tag?: string): Date | null {
  const grouped = byCard(reviews)
  const dues = cards.filter(c => !c.deleted_at && grouped.has(c.id) && (tag === undefined || hasTag(c, tag)))
    .map(c => stateFromReviews(grouped.get(c.id)!).due)
    .filter(d => d > now)
  return dues.length ? new Date(Math.min(...dues.map(d => d.getTime()))) : null
}
