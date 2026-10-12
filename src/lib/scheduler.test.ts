import { describe, it, expect } from 'vitest'
import { State } from 'ts-fsrs'
import { stateFromReviews, previewDue, isNew } from './scheduler'
import type { Review } from './types'

const r = (rating: 1 | 2 | 3, at: string, id = at): Review =>
  ({ id, card_id: 'c1', rating, reviewed_at: at, synced: 1 })

describe('scheduler', () => {
  it('sans review : carte nouvelle', () => {
    expect(isNew(stateFromReviews([]))).toBe(true)
  })
  it('rejoue dans l’ordre chronologique, quel que soit l’ordre reçu', () => {
    const a = [r(3, '2026-10-01T10:00:00Z'), r(3, '2026-10-02T10:00:00Z')]
    const b = [...a].reverse()
    expect(stateFromReviews(b).due.getTime()).toBe(stateFromReviews(a).due.getTime())
  })
  it('déterministe (pas de fuzz)', () => {
    const rs = [r(3, '2026-10-01T10:00:00Z'), r(3, '2026-10-03T10:00:00Z'), r(3, '2026-10-10T10:00:00Z')]
    expect(stateFromReviews(rs).due.getTime()).toBe(stateFromReviews(rs).due.getTime())
  })
  it('Again repasse la carte en (re)apprentissage', () => {
    const rs = [r(3, '2026-10-01T10:00:00Z'), r(3, '2026-10-03T10:00:00Z'), r(1, '2026-10-10T10:00:00Z')]
    expect(stateFromReviews(rs).state).toBe(State.Relearning)
  })
  it('aperçu : Again < Hard <= Good', () => {
    const now = new Date('2026-10-12T10:00:00Z')
    const p = previewDue(stateFromReviews([r(3, '2026-10-01T10:00:00Z')]), now)
    expect(p[1].getTime()).toBeLessThan(p[2].getTime())
    expect(p[2].getTime()).toBeLessThanOrEqual(p[3].getTime())
  })
})
