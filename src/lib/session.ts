import { State } from 'ts-fsrs'
import { stateFromReviews, isNew, type FsrsCard } from './scheduler'
import type { Card, Review } from './types'

export interface SessionItem { card: Card; state: FsrsCard }

const sameLocalDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

function byCard(reviews: Review[]) {
  const m = new Map<string, Review[]>()
  for (const r of reviews) m.set(r.card_id, [...(m.get(r.card_id) ?? []), r])
  return m
}

export function buildQueue(cards: Card[], reviews: Review[], now: Date, newLimit = 20): SessionItem[] {
  const grouped = byCard(reviews)
  const live = cards.filter(c => !c.deleted_at)
  const items = live.map(card => ({ card, state: stateFromReviews(grouped.get(card.id) ?? []) }))

  const introducedToday = [...grouped.values()].filter(rs => {
    const first = rs.reduce((a, b) => (a.reviewed_at < b.reviewed_at ? a : b))
    return sameLocalDay(new Date(first.reviewed_at), now)
  }).length

  const due = items.filter(i => !isNew(i.state) && i.state.due <= now)
    .sort((a, b) => a.state.due.getTime() - b.state.due.getTime())
  const fresh = items.filter(i => isNew(i.state))
    .sort((a, b) => a.card.source_path.localeCompare(b.card.source_path) || a.card.id.localeCompare(b.card.id))
    .slice(0, Math.max(0, newLimit - introducedToday))
  return [...due, ...fresh]
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

export function nextDue(cards: Card[], reviews: Review[], now: Date): Date | null {
  const grouped = byCard(reviews)
  const dues = cards.filter(c => !c.deleted_at && grouped.has(c.id))
    .map(c => stateFromReviews(grouped.get(c.id)!).due)
    .filter(d => d > now)
  return dues.length ? new Date(Math.min(...dues.map(d => d.getTime()))) : null
}
