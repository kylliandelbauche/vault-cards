import { fsrs, createEmptyCard, Rating as F, State, type Card as FsrsCard, type Grade } from 'ts-fsrs'
import type { Rating, Review } from './types'

const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: false })
const toGrade = (r: Rating): Grade => (r === 1 ? F.Again : r === 2 ? F.Hard : F.Good)

export type { FsrsCard }

export function stateFromReviews(reviews: Review[]): FsrsCard {
  const sorted = [...reviews].sort((a, b) => a.reviewed_at.localeCompare(b.reviewed_at))
  let card = createEmptyCard(new Date(0))
  for (const rv of sorted) card = scheduler.next(card, new Date(rv.reviewed_at), toGrade(rv.rating)).card
  return card
}

export function previewDue(state: FsrsCard, now: Date): Record<Rating, Date> {
  const p = scheduler.repeat(state, now)
  return { 1: p[F.Again].card.due, 2: p[F.Hard].card.due, 3: p[F.Good].card.due }
}

export const isNew = (s: FsrsCard) => s.state === State.New
