import { State } from 'ts-fsrs'
import { TAGS, type TagDef } from '../../shared/tags'
import { isNew, type FsrsCard } from './scheduler'
import { byCard, hasTag, NEW_PER_DAY, queueOf, scheduleItems, type SessionItem } from './session'
import type { Card, Review } from './types'

/**
 * Seuil « maîtrisée » (cadrage #53) : stabilité FSRS ≥ 21 jours, l'équivalent du « mature » d'Anki
 * (intervalle ≥ 21 j ; avec la rétention cible de 90 %, l'intervalle vaut à peu près la stabilité).
 */
export const MASTERED_STABILITY_DAYS = 21

export const isMastered = (s: FsrsCard) => s.state === State.Review && s.stability >= MASTERED_STABILITY_DAYS

/** Compteurs du bloc du jour (toutes les cartes) ; pour un tag, seuls `total` et `today` servent (page Mes tags). */
export interface DayCounts {
  /** Taille de la file du jour = `due` + `fresh` (même calcul que la session « Commencer à étudier »). */
  today: number
  /** À revoir : cartes déjà vues dont l'échéance est passée (dues maintenant). */
  due: number
  /** Nouvelles : jamais vues, dans la limite du quota du jour (ce qui sera réellement proposé). */
  fresh: number
  /** Maîtrisées : état Review et stabilité ≥ MASTERED_STABILITY_DAYS. */
  mastered: number
  /** Cartes vivantes (une carte à 2 tags compte dans les deux). */
  total: number
  /** Prochaine échéance à venir (cartes déjà vues), ou null. */
  nextDueAt: Date | null
}

/** Un tag de shared/tags.ts avec son nombre de cartes et sa file du jour (quota de nouvelles global). */
export interface TagCount extends TagDef, Pick<DayCounts, 'total' | 'today'> {}

export interface HomeStats extends DayCounts {
  /** Les tags de shared/tags.ts, dans leur ordre, avec leurs compteurs. */
  tags: TagCount[]
}

function dayCounts(items: SessionItem[], grouped: Map<string, Review[]>, now: Date, newLimit: number, tag?: string): DayCounts {
  const scoped = tag === undefined ? items : items.filter(i => hasTag(i.card, tag))
  const queue = queueOf(scoped, grouped, now, newLimit)
  const fresh = queue.filter(i => isNew(i.state)).length
  let next = Infinity
  let mastered = 0
  for (const { state } of scoped) {
    if (!isNew(state) && state.due > now) next = Math.min(next, state.due.getTime())
    if (isMastered(state)) mastered++
  }
  return {
    today: queue.length,
    due: queue.length - fresh,
    fresh,
    mastered,
    total: scoped.length,
    nextDueAt: Number.isFinite(next) ? new Date(next) : null,
  }
}

/** Compteurs de l'écran d'accueil, calculés depuis l'historique local (aucune donnée nouvelle). */
export function homeStats(cards: Card[], reviews: Review[], now: Date, newLimit = NEW_PER_DAY): HomeStats {
  const grouped = byCard(reviews)
  const items = scheduleItems(cards, grouped)
  return {
    ...dayCounts(items, grouped, now, newLimit),
    tags: TAGS.map(({ slug, label }) => {
      const { total, today } = dayCounts(items, grouped, now, newLimit, slug)
      return { slug, label, total, today }
    }),
  }
}

/** Tags triés par nombre de cartes décroissant (vides en dernier) ; à égalité, l'ordre de shared/tags.ts. */
export const sortTags = (tags: TagCount[]): TagCount[] =>
  tags.map((t, i) => ({ t, i })).sort((a, b) => b.t.total - a.t.total || a.i - b.i).map(x => x.t)

/** Raccourcis de l'accueil (#63) : les tags non vides, triés. */
export const shortcutTags = (tags: TagCount[]): TagCount[] => sortTags(tags).filter(t => t.total > 0)

/** « 0 carte », « 1 carte », « 12 cartes » (en français, 0 et 1 au singulier). */
export const cards = (n: number) => `${n} ${n > 1 ? 'cartes' : 'carte'}`

/** Fin de la phrase du bloc principal, après le nombre : « carte(s) à revoir aujourd'hui ». */
export const todaySuffix = (n: number) => `${n > 1 ? 'cartes' : 'carte'} à revoir aujourd'hui`

/** Sous-titre de la page Mes tags (#82) : « 10 cartes à revoir » (file du jour, toutes les cartes), « Tout est à jour » sinon. */
export const tagsSubtitle = (today: number) => (today > 0 ? `${cards(today)} à revoir` : 'Tout est à jour')
