import { useCallback, useEffect, useRef, useState } from 'react'
import { stateFromReviews } from '../../lib/scheduler'
import { buildQueue, countKinds, freeQueue, nextDue, type SessionItem } from '../../lib/session'
import type { Card, Rating, Review } from '../../lib/types'

export interface ReviewStore {
  loadCards(): Promise<Card[]>
  loadReviews(): Promise<Review[]>
  addReview(r: Review): Promise<void>
}

export const memoryStore = (cards: Card[]): ReviewStore => {
  const reviews: Review[] = []
  return {
    loadCards: async () => [...cards],
    loadReviews: async () => [...reviews],
    addReview: async r => { reviews.push(r) },
  }
}

/** `idle` : aucune session demandée (écran d'accueil). */
type Status = 'idle' | 'loading' | 'error' | 'empty' | 'reviewing' | 'done'

/** Ce que la session doit proposer : file du jour (`due`) ou révision libre (`all`), éventuellement limitée à un tag. */
export interface SessionScope {
  mode: 'due' | 'all'
  tag?: string
}

/** Session par défaut : dues + nouvelles du jour, toutes les cartes. */
export const DUE_SESSION: SessionScope = { mode: 'due' }
type Stats = { again: number; hard: number; good: number }

export interface ReviewSession {
  status: Status
  current: SessionItem | null
  revealed: boolean
  /** La dernière note n'a pas pu être enregistrée : la carte reste affichée, on peut renoter. */
  saveFailed: boolean
  reveal(): void
  rate(r: Rating): void
  counts: { new: number; learn: number; due: number }
  progress: number // 0..1
  stats: Stats
  nextDueAt: Date | null
  /** Recharge une session normale : cartes dues + nouvelles du jour (du tag de la session, s'il y en a un). */
  restart(): void
  /** Révision libre (« Réviser à nouveau ») : toutes les cartes vivantes (du tag), dues ou non. */
  reviewAll(): void
}

interface State {
  /** Session à laquelle cet état appartient (identité de l'objet) ; un état d'une autre session est ignoré. */
  scope: SessionScope | null
  status: Status
  queue: SessionItem[]
  revealed: boolean
  saveFailed: boolean
  processed: number
  stats: Stats
  nextDueAt: Date | null
  /** Instant (ms) du dernier changement d'écran : réponse révélée ou carte notée. */
  shownAt: number
}

/**
 * Après une révélation, la barre de notation prend la place du bouton « Afficher la réponse »
 * (et inversement après une note) : le 2e tap d'un double tap tomberait sur l'autre bouton.
 * Toute note ou révélation arrivant moins de ce délai après le changement d'écran est ignorée.
 */
export const SCREEN_CHANGE_GUARD_MS = 400

const ZERO: Stats = { again: 0, hard: 0, good: 0 }
const INITIAL: State = { scope: null, status: 'loading', queue: [], revealed: false, saveFailed: false, processed: 0, stats: ZERO, nextDueAt: null, shownAt: -Infinity }
const failed = (scope: SessionScope): State => ({ ...INITIAL, scope, status: 'error' })
const STAT_KEY = { 1: 'again', 2: 'hard', 3: 'good' } as const
const systemNow = () => new Date()

/**
 * Le store est lu quand `scope` change (identité de l'objet : un nouvel objet relance une session, même
 * identique) et à `restart()` / `reviewAll()` (échec de lecture → status `error`). `scope` null : status `idle`,
 * rien n'est lu. Un `store` ou un `now` recréé à chaque rendu ne relance rien.
 */
export function useReviewSession(store: ReviewStore, now: () => Date = systemNow, scope: SessionScope | null = DUE_SESSION): ReviewSession {
  const [state, setState] = useState<State>(INITIAL)
  // Miroir synchrone de l'état, lu par les gestionnaires pour éviter les closures périmées.
  const live = useRef<State>(INITIAL)
  const cards = useRef<Card[]>([])
  const reviews = useRef<Review[]>([])
  const rating = useRef(false)
  // Numéro du dernier chargement lancé : un chargement plus ancien qui se termine après est ignoré.
  const generation = useRef(0)
  // Dernières valeurs de `store` / `now` / `scope`, lues par les gestionnaires sans en faire des dépendances.
  const io = useRef({ store, now, scope })
  useEffect(() => { io.current = { store, now, scope } })

  const commit = useCallback((next: State) => {
    live.current = next
    setState(next)
  }, [])

  // Lit le store et prépare l'état de départ de `scope`, puis l'applique s'il est encore le dernier demandé.
  const load = useCallback((target: SessionScope, mode: SessionScope['mode']) => {
    const gen = ++generation.current
    const { store, now } = io.current
    Promise.all([store.loadCards(), store.loadReviews()]).then(([cs, rs]) => {
      if (gen !== generation.current) return
      const t = now()
      const queue = mode === 'all' ? freeQueue(cs, rs, t, target.tag) : buildQueue(cs, rs, t, undefined, target.tag)
      const hasLiveCards = cs.some(c => !c.deleted_at)
      cards.current = cs
      reviews.current = rs
      commit({
        ...INITIAL,
        scope: target,
        status: queue.length ? 'reviewing' : hasLiveCards ? 'done' : 'empty',
        queue,
        nextDueAt: queue.length ? null : nextDue(cs, rs, t, target.tag),
      })
    }, () => {
      if (gen === generation.current) commit(failed(target))
    })
  }, [commit])

  useEffect(() => {
    if (scope) load(scope, scope.mode)
    else generation.current++ // retour à l'accueil : un chargement en cours ne s'applique plus
  }, [scope, load])

  const reveal = useCallback(() => {
    const s = live.current
    if (s.scope !== io.current.scope || s.status !== 'reviewing' || s.revealed) return
    const t = io.current.now().getTime()
    if (t - s.shownAt < SCREEN_CHANGE_GUARD_MS) return
    commit({ ...s, revealed: true, shownAt: t })
  }, [commit])

  const rate = useCallback(async (r: Rating) => {
    const s = live.current
    const item = s.queue[0]
    if (rating.current || s.scope !== io.current.scope || s.status !== 'reviewing' || !s.revealed || !item) return
    const { store, now } = io.current
    if (now().getTime() - s.shownAt < SCREEN_CHANGE_GUARD_MS) return
    rating.current = true // posé avant tout await : un double tap n'enregistre qu'une review
    try {
      const review: Review = {
        id: crypto.randomUUID(),
        card_id: item.card.id,
        rating: r,
        reviewed_at: now().toISOString(),
        synced: 0,
      }
      try {
        await store.addReview(review)
      } catch {
        commit({ ...live.current, saveFailed: true })
        return
      }
      reviews.current = [...reviews.current, review]
      const updated = stateFromReviews(reviews.current.filter(x => x.card_id === item.card.id))
      const rest = live.current.queue.slice(1)
      const queue = r === 1 ? [...rest, { card: item.card, state: updated }] : rest
      const finished = queue.length === 0
      const t = now()
      commit({
        ...live.current,
        status: finished ? 'done' : 'reviewing',
        queue,
        revealed: false,
        saveFailed: false,
        processed: live.current.processed + 1,
        stats: { ...live.current.stats, [STAT_KEY[r]]: live.current.stats[STAT_KEY[r]] + 1 },
        nextDueAt: finished ? nextDue(cards.current, reviews.current, t) : null,
        shownAt: t.getTime(),
      })
    } finally {
      rating.current = false
    }
  }, [commit])

  const reload = useCallback((mode: SessionScope['mode']) => {
    const target = io.current.scope
    if (!target) return
    if (live.current.status === 'error') commit({ ...INITIAL, scope: target })
    load(target, mode)
  }, [load, commit])
  const restart = useCallback(() => reload('due'), [reload])
  const reviewAll = useCallback(() => reload('all'), [reload])

  const total = state.processed + state.queue.length
  // Session demandée mais pas encore chargée (ou état d'une session précédente) : « loading ».
  const status: Status = scope === null ? 'idle' : state.scope === scope ? state.status : 'loading'
  return {
    status,
    current: status === 'reviewing' ? state.queue[0] ?? null : null,
    revealed: state.revealed,
    saveFailed: state.saveFailed,
    reveal,
    rate,
    counts: countKinds(state.queue),
    progress: total ? state.processed / total : 0,
    stats: state.stats,
    nextDueAt: state.nextDueAt,
    restart,
    reviewAll,
  }
}
