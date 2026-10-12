import { useCallback, useEffect, useRef, useState } from 'react'
import { stateFromReviews } from '../../lib/scheduler'
import { buildQueue, countKinds, nextDue, type SessionItem } from '../../lib/session'
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

type Status = 'loading' | 'empty' | 'reviewing' | 'done'
type Stats = { again: number; hard: number; good: number }

export interface ReviewSession {
  status: Status
  current: SessionItem | null
  revealed: boolean
  reveal(): void
  rate(r: Rating): void
  counts: { new: number; learn: number; due: number }
  progress: number // 0..1
  stats: Stats
  nextDueAt: Date | null
  restart(): void
}

interface State {
  status: Status
  queue: SessionItem[]
  revealed: boolean
  processed: number
  stats: Stats
  nextDueAt: Date | null
}

const ZERO: Stats = { again: 0, hard: 0, good: 0 }
const INITIAL: State = { status: 'loading', queue: [], revealed: false, processed: 0, stats: ZERO, nextDueAt: null }
const STAT_KEY = { 1: 'again', 2: 'hard', 3: 'good' } as const
const systemNow = () => new Date()

/** `store` et `now` doivent être stables (définis hors du rendu) : les changer relance le chargement. */
export function useReviewSession(store: ReviewStore, now: () => Date = systemNow): ReviewSession {
  const [state, setState] = useState<State>(INITIAL)
  // Miroir synchrone de l'état, lu par les gestionnaires pour éviter les closures périmées.
  const live = useRef<State>(INITIAL)
  const cards = useRef<Card[]>([])
  const reviews = useRef<Review[]>([])
  const rating = useRef(false)

  const commit = useCallback((next: State) => {
    live.current = next
    setState(next)
  }, [])

  // Lit le store et prépare l'état de départ, sans toucher à l'état React.
  const load = useCallback(async () => {
    const [cs, rs] = await Promise.all([store.loadCards(), store.loadReviews()])
    const t = now()
    const queue = buildQueue(cs, rs, t)
    const hasLiveCards = cs.some(c => !c.deleted_at)
    const next: State = {
      ...INITIAL,
      status: queue.length ? 'reviewing' : hasLiveCards ? 'done' : 'empty',
      queue,
      nextDueAt: queue.length ? null : nextDue(cs, rs, t),
    }
    return { cs, rs, next }
  }, [store, now])

  const apply = useCallback(({ cs, rs, next }: Awaited<ReturnType<typeof load>>) => {
    cards.current = cs
    reviews.current = rs
    commit(next)
  }, [commit])

  useEffect(() => {
    let current = true
    void load().then(loaded => { if (current) apply(loaded) })
    return () => { current = false }
  }, [load, apply])

  const reveal = useCallback(() => {
    const s = live.current
    if (s.status === 'reviewing' && !s.revealed) commit({ ...s, revealed: true })
  }, [commit])

  const rate = useCallback(async (r: Rating) => {
    const s = live.current
    const item = s.queue[0]
    if (rating.current || s.status !== 'reviewing' || !s.revealed || !item) return
    rating.current = true // posé avant tout await : un double tap n'enregistre qu'une review
    try {
      const review: Review = {
        id: crypto.randomUUID(),
        card_id: item.card.id,
        rating: r,
        reviewed_at: now().toISOString(),
        synced: 0,
      }
      await store.addReview(review)
      reviews.current = [...reviews.current, review]
      const updated = stateFromReviews(reviews.current.filter(x => x.card_id === item.card.id))
      const rest = live.current.queue.slice(1)
      const queue = r === 1 ? [...rest, { card: item.card, state: updated }] : rest
      const finished = queue.length === 0
      commit({
        ...live.current,
        status: finished ? 'done' : 'reviewing',
        queue,
        revealed: false,
        processed: live.current.processed + 1,
        stats: { ...live.current.stats, [STAT_KEY[r]]: live.current.stats[STAT_KEY[r]] + 1 },
        nextDueAt: finished ? nextDue(cards.current, reviews.current, now()) : null,
      })
    } finally {
      rating.current = false
    }
  }, [store, now, commit])

  const restart = useCallback(() => { void load().then(apply) }, [load, apply])

  const total = state.processed + state.queue.length
  return {
    status: state.status,
    current: state.status === 'reviewing' ? state.queue[0] ?? null : null,
    revealed: state.revealed,
    reveal,
    rate,
    counts: countKinds(state.queue),
    progress: total ? state.processed / total : 0,
    stats: state.stats,
    nextDueAt: state.nextDueAt,
    restart,
  }
}
