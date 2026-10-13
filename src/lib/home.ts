import { State } from 'ts-fsrs'
import { TAGS, type TagDef } from '../../shared/tags'
import { isNew, type FsrsCard } from './scheduler'
import { byCard, hasTag, NEW_PER_DAY, queueOf, scheduleItems } from './session'
import type { Card, Review } from './types'

/**
 * Seuil « maîtrisée » (cadrage #53) : stabilité FSRS ≥ 21 jours, l'équivalent du « mature » d'Anki
 * (intervalle ≥ 21 j ; avec la rétention cible de 90 %, l'intervalle vaut à peu près la stabilité).
 */
export const MASTERED_STABILITY_DAYS = 21

export const isMastered = (s: FsrsCard) => s.state === State.Review && s.stability >= MASTERED_STABILITY_DAYS

export interface TagCount extends TagDef {
  /** Cartes vivantes portant ce tag (une carte à 2 tags compte dans les deux). */
  count: number
}

export interface HomeStats {
  /** Taille de la file du jour = `due` + `fresh` (même calcul que la session « Commencer à étudier »). */
  today: number
  /** À revoir : cartes déjà vues dont l'échéance est passée (dues maintenant). */
  due: number
  /** Nouvelles : jamais vues, dans la limite du quota du jour (ce qui sera réellement proposé). */
  fresh: number
  /** Maîtrisées : état Review et stabilité ≥ MASTERED_STABILITY_DAYS. */
  mastered: number
  /** Cartes vivantes. */
  total: number
  /** Les tags de shared/tags.ts, dans leur ordre, avec leur nombre de cartes. */
  tags: TagCount[]
  /** Prochaine échéance à venir (cartes déjà vues), ou null. */
  nextDueAt: Date | null
}

/** Compteurs de l'écran d'accueil, calculés depuis l'historique local (aucune donnée nouvelle). */
export function homeStats(cards: Card[], reviews: Review[], now: Date, newLimit = NEW_PER_DAY): HomeStats {
  const grouped = byCard(reviews)
  const items = scheduleItems(cards, grouped)
  const queue = queueOf(items, grouped, now, newLimit)
  const fresh = queue.filter(i => isNew(i.state)).length
  let next = Infinity
  for (const { state } of items) if (!isNew(state) && state.due > now) next = Math.min(next, state.due.getTime())
  return {
    today: queue.length,
    due: queue.length - fresh,
    fresh,
    mastered: items.filter(i => isMastered(i.state)).length,
    total: items.length,
    tags: TAGS.map(t => ({ ...t, count: items.filter(i => hasTag(i.card, t.slug)).length })),
    nextDueAt: Number.isFinite(next) ? new Date(next) : null,
  }
}

/** « 0 carte », « 1 carte », « 12 cartes » (en français, 0 et 1 au singulier). */
export const cards = (n: number) => `${n} ${n > 1 ? 'cartes' : 'carte'}`

/** Fin de la phrase du bloc principal, après le nombre : « carte(s) à revoir aujourd'hui ». */
export const todaySuffix = (n: number) => `${n > 1 ? 'cartes' : 'carte'} à revoir aujourd'hui`
