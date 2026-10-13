import { describe, it, expect } from 'vitest'
import { buildQueue, countKinds, freeQueue, nextDue } from './session'
import type { Card, Review } from './types'

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id, deck: 'ia', tags: ['ia'], source_path: `3-Resources/veille/ia/${id}.md`, front: id, back: id,
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

describe('freeQueue (révision libre)', () => {
  it('toutes les cartes vivantes, dues ou non, sans limite de nouvelles ; jamais les supprimées', () => {
    const cards = [...Array.from({ length: 25 }, (_, i) => card(`n${i}`)), card('later'), card('gone', { deleted_at: '2026-10-02T00:00:00Z' })]
    const q = freeQueue(cards, [rv('later', '2026-10-12T09:59:00Z')], now)
    expect(q).toHaveLength(26)
    expect(q.map(i => i.card.id)).not.toContain('gone')
    expect(q[0].card.id).toBe('later') // cartes déjà vues d'abord (échéance la plus proche), puis nouvelles
  })
})

describe('session limitée à un tag (#53)', () => {
  const tagged = (id: string, tags: string[]) => card(id, { tags })
  it('dues + nouvelles du tag seulement ; une carte à 2 tags est dans les deux', () => {
    const cards = [tagged('ia-due', ['ia']), tagged('dev-due', ['dev']), tagged('both', ['ia', 'dev']), tagged('dev-new', ['dev'])]
    const rs = [rv('ia-due', '2026-09-01T10:00:00Z'), rv('dev-due', '2026-09-01T10:00:00Z')]
    expect(buildQueue(cards, rs, now, 20, 'ia').map(i => i.card.id)).toEqual(['ia-due', 'both'])
    expect(buildQueue(cards, rs, now, 20, 'dev').map(i => i.card.id)).toEqual(['dev-due', 'both', 'dev-new'])
    expect(buildQueue(cards, rs, now, 20, 'culture')).toEqual([])
  })
  it('quota global : les nouvelles vues aujourd’hui sur un autre tag sont décomptées', () => {
    const cards = [...Array.from({ length: 15 }, (_, i) => tagged(`d${i}`, ['dev'])), ...Array.from({ length: 15 }, (_, i) => tagged(`i${i}`, ['ia']))]
    const devToday = Array.from({ length: 15 }, (_, i) => rv(`d${i}`, `2026-10-12T08:${String(i).padStart(2, '0')}:00Z`))
    const q = buildQueue(cards, devToday, now, 20, 'ia')
    expect(q.filter(i => i.state.reps === 0)).toHaveLength(5)
  })
  it('révision libre du tag : toutes ses cartes, sans limite, et seulement elles', () => {
    const cards = [...Array.from({ length: 25 }, (_, i) => tagged(`n${i}`, ['ia'])), tagged('x', ['dev'])]
    const q = freeQueue(cards, [], now, 'ia')
    expect(q).toHaveLength(25)
    expect(q.map(i => i.card.id)).not.toContain('x')
  })
  it('prochaine échéance limitée au tag', () => {
    const cards = [tagged('a', ['ia']), tagged('b', ['dev'])]
    const rs = [rv('a', '2026-10-12T09:59:00Z'), rv('b', '2026-10-12T09:50:00Z', 1)]
    expect(nextDue(cards, rs, now, 'ia')!.getTime()).toBe(nextDue([cards[0]], rs, now)!.getTime())
  })
})
