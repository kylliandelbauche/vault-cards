import { describe, it, expect } from 'vitest'
import { buildQueue, countKinds, nextDue } from './session'
import type { Card, Review } from './types'

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id, deck: 'ia', source_path: `3-Resources/veille/ia/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null, ...extra,
})
const rv = (card_id: string, at: string, rating: 1 | 2 | 3 = 3): Review =>
  ({ id: `${card_id}-${at}`, card_id, rating, reviewed_at: at, synced: 1 })
const now = new Date('2026-10-12T10:00:00Z')

describe('buildQueue', () => {
  it('exclut les cartes supprimées', () => {
    expect(buildQueue([card('a', { deleted_at: '2026-10-02T00:00:00Z' })], [], now)).toHaveLength(0)
  })
  it('dues d’abord, puis nouvelles', () => {
    const q = buildQueue([card('new1'), card('old')], [rv('old', '2026-09-01T10:00:00Z')], now)
    expect(q.map(i => i.card.id)).toEqual(['old', 'new1'])
  })
  it('exclut les cartes pas encore dues', () => {
    expect(buildQueue([card('a')], [rv('a', '2026-10-12T09:59:00Z')], now)
      .filter(i => i.card.id === 'a' && i.state.due > now)).toHaveLength(0)
  })
  it('limite les nouvelles à 20 par jour, en comptant celles déjà vues aujourd’hui', () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(`n${i}`))
    const seenToday = [rv('n0', '2026-10-12T08:00:00Z'), rv('n1', '2026-10-12T08:01:00Z')]
    const q = buildQueue(cards, seenToday, now, 20)
    expect(q.filter(i => i.state.reps === 0)).toHaveLength(18)
  })
})

describe('countKinds / nextDue', () => {
  it('compte nouvelles / en apprentissage / dues', () => {
    const q = buildQueue([card('n'), card('l'), card('d')],
      // 'd' : deux « Good » pour sortir des étapes d'apprentissage (1m, 10m) et passer en Review
      [rv('l', '2026-10-12T09:00:00Z', 1), rv('d', '2026-09-01T10:00:00Z'), rv('d', '2026-09-01T10:20:00Z')], now)
    expect(countKinds(q)).toEqual({ new: 1, learn: 1, due: 1 })
  })
  it('nextDue : null si aucune carte révisée', () => {
    expect(nextDue([card('a')], [], now)).toBeNull()
  })
})
