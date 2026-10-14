import { describe, it, expect } from 'vitest'
import { buildQueue, countKinds, freeQueue, nextDue } from './session'
import type { Card, Review } from './types'

const card = (id: string, extra: Partial<Card> = {}): Card => ({
  id, source: 'vault', deck: 'ia', tags: ['ia'], source_path: `3-Resources/veille/ia/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null, ...extra,
})
const rv = (card_id: string, at: string, rating: 1 | 2 | 3 = 3): Review =>
  ({ id: `${card_id}-${at}`, card_id, rating, reviewed_at: at, synced: 1 })
// Midi, heure locale : « aujourd'hui » (jour local du quota) est le même jour dans tous les fuseaux.
const now = new Date(2026, 9, 12, 12, 0)
/** Instant `min` minutes avant `now` (même jour local). */
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()

describe('buildQueue', () => {
  it('exclut les cartes supprimées', () => {
    expect(buildQueue([card('a', { deleted_at: '2026-10-02T00:00:00Z' })], [], now)).toHaveLength(0)
  })
  it('dues d’abord, puis nouvelles', () => {
    const q = buildQueue([card('new1'), card('old')], [rv('old', '2026-09-01T10:00:00Z')], now)
    expect(q.map(i => i.card.id)).toEqual(['old', 'new1'])
  })
  it('exclut les cartes pas encore dues', () => {
    expect(buildQueue([card('a')], [rv('a', ago(1))], now)
      .filter(i => i.card.id === 'a' && i.state.due > now)).toHaveLength(0)
  })
  it('limite les nouvelles à 20 par jour, en comptant celles déjà vues aujourd’hui', () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(`n${i}`))
    const seenToday = [rv('n0', ago(120)), rv('n1', ago(119))]
    const q = buildQueue(cards, seenToday, now, 20)
    expect(q.filter(i => i.state.reps === 0)).toHaveLength(18)
  })
})

describe('cartes manuelles (#54) : sans source_path', () => {
  it('nouvelles manuelles et vault mélangées : pas d’erreur, manuelles d’abord (créées exprès), puis l’ordre habituel', () => {
    const now = new Date('2026-10-14T10:00:00Z')
    const manual = (id: string) => card(id, { source: 'manual', deck: null, source_path: null })
    const q = buildQueue([card('v2'), manual('m2'), card('v1'), manual('m1')], [], now)
    expect(q.map(i => i.card.id)).toEqual(['m1', 'm2', 'v1', 'v2'])
    expect(nextDue([manual('m1')], [], now)).toBeNull()
  })
})

describe('quota du jour : jour local', () => {
  it('une nouvelle vue hier à 23:59 (heure locale) ne compte plus dans le quota à 00:01', () => {
    const cards = Array.from({ length: 30 }, (_, i) => card(`n${i}`))
    const lateYesterday = [rv('n0', new Date(2026, 9, 12, 23, 59).toISOString())]
    const fresh = (at: Date) => buildQueue(cards, lateYesterday, at, 20).filter(i => i.state.reps === 0).length
    expect(fresh(new Date(2026, 9, 12, 23, 59, 30))).toBe(19) // même jour : décomptée
    expect(fresh(new Date(2026, 9, 13, 0, 1))).toBe(20) // lendemain : quota neuf
  })
})

describe('quota du jour : révision libre (#22)', () => {
  const cards = Array.from({ length: 30 }, (_, i) => card(`n${i}`))
  const fresh = (reviews: Review[]) => buildQueue(cards, reviews, now, 20).filter(i => i.state.reps === 0).length

  it('une nouvelle notée en révision libre ne consomme pas le quota (une autre nouvelle prend sa place)', () => {
    expect(fresh([{ ...rv('n0', ago(10)), free: true }, { ...rv('n1', ago(9)), free: true }])).toBe(20)
    expect(buildQueue(cards, [{ ...rv('n0', ago(10)), free: true }], now, 20).filter(i => i.state.reps === 0).map(i => i.card.id)).not.toContain('n0')
  })

  it('seule la première note compte : vue en session normale puis revue en libre → décomptée ; l’inverse → non', () => {
    expect(fresh([rv('n0', ago(10)), { ...rv('n0', ago(5)), free: true }])).toBe(19)
    expect(fresh([{ ...rv('n0', ago(10)), free: true }, rv('n0', ago(5))])).toBe(20)
  })
})

describe('countKinds / nextDue', () => {
  it('compte nouvelles / en apprentissage / dues', () => {
    const q = buildQueue([card('n'), card('l'), card('d')],
      // 'd' : deux « Good » pour sortir des étapes d'apprentissage (1m, 10m) et passer en Review
      [rv('l', ago(60), 1), rv('d', '2026-09-01T10:00:00Z'), rv('d', '2026-09-01T10:20:00Z')], now)
    expect(countKinds(q)).toEqual({ new: 1, learn: 1, due: 1 })
  })
  it('nextDue : null si aucune carte révisée', () => {
    expect(nextDue([card('a')], [], now)).toBeNull()
  })
})

describe('freeQueue (révision libre)', () => {
  it('toutes les cartes vivantes, dues ou non, sans limite de nouvelles ; jamais les supprimées', () => {
    const cards = [...Array.from({ length: 25 }, (_, i) => card(`n${i}`)), card('later'), card('gone', { deleted_at: '2026-10-02T00:00:00Z' })]
    const q = freeQueue(cards, [rv('later', ago(1))], now)
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
    const devToday = Array.from({ length: 15 }, (_, i) => rv(`d${i}`, ago(120 - i)))
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
    const rs = [rv('a', ago(1)), rv('b', ago(10), 1)]
    expect(nextDue(cards, rs, now, 'ia')!.getTime()).toBe(nextDue([cards[0]], rs, now)!.getTime())
  })
})
