import { describe, it, expect } from 'vitest'
import { TAGS } from '../../shared/tags'
import { cards as cardsLabel, homeStats, isMastered, MASTERED_STABILITY_DAYS, todaySuffix } from './home'
import { stateFromReviews } from './scheduler'
import { buildQueue } from './session'
import type { Card, Review } from './types'

const card = (id: string, tags: string[] = ['ia'], extra: Partial<Card> = {}): Card => ({
  id, deck: 'x', tags, source_path: `x/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null, ...extra,
})
const rv = (card_id: string, at: string, rating: 1 | 2 | 3 = 3): Review =>
  ({ id: `${card_id}-${at}`, card_id, rating, reviewed_at: at, synced: 1 })
// Midi, heure locale : « aujourd'hui » (jour local du quota) est le même jour dans tous les fuseaux.
const now = new Date(2026, 9, 12, 12, 0)
/** Instant `min` minutes avant `now` (même jour local). */
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()

/** Historique de « Très bien » espacés : chaque note tombe à l'échéance de la précédente. */
function goodStreak(id: string, start: string, n: number): Review[] {
  const out: Review[] = []
  let at = new Date(start)
  for (let i = 0; i < n; i++) {
    out.push(rv(id, at.toISOString()))
    at = stateFromReviews(out).due
  }
  return out
}

describe('homeStats : compteurs', () => {
  it('À revoir = dues maintenant ; pas les cartes vues pas encore dues ; jamais les supprimées', () => {
    const s = homeStats(
      [card('due'), card('later'), card('gone', ['ia'], { deleted_at: '2026-10-02T00:00:00Z' })],
      [rv('due', '2026-09-01T10:00:00Z'), rv('later', ago(1)), rv('gone', '2026-09-01T10:00:00Z')],
      now,
    )
    expect(s.due).toBe(1)
    expect(s.total).toBe(2)
  })

  it('Nouvelles = jamais vues, dans la limite de 20 par jour (celles déjà vues aujourd’hui décomptées)', () => {
    const cs = Array.from({ length: 30 }, (_, i) => card(`n${i}`))
    expect(homeStats(cs, [], now).fresh).toBe(20)
    const seenToday = [rv('n0', ago(120)), rv('n1', ago(119))]
    expect(homeStats(cs, seenToday, now).fresh).toBe(18)
    expect(homeStats(cs.slice(0, 5), [], now).fresh).toBe(5)
  })

  it('cartes du jour = dues + nouvelles = taille exacte de la file « Commencer à étudier »', () => {
    const cs = [...Array.from({ length: 25 }, (_, i) => card(`n${i}`)), card('d1'), card('d2')]
    const rs = [rv('d1', '2026-09-01T10:00:00Z'), rv('d2', '2026-09-02T10:00:00Z'), rv('n0', ago(120))]
    const s = homeStats(cs, rs, now)
    expect(s.today).toBe(buildQueue(cs, rs, now).length)
    expect(s.today).toBe(s.due + s.fresh)
  })

  it(`Maîtrisées = état Review et stabilité ≥ ${MASTERED_STABILITY_DAYS} jours`, () => {
    const long = goodStreak('m', '2026-01-01T10:00:00Z', 6)
    const short = goodStreak('s', '2026-10-01T10:00:00Z', 2)
    expect(stateFromReviews(long).stability).toBeGreaterThanOrEqual(MASTERED_STABILITY_DAYS)
    expect(stateFromReviews(short).stability).toBeLessThan(MASTERED_STABILITY_DAYS)
    expect(homeStats([card('m'), card('s'), card('n')], [...long, ...short], now).mastered).toBe(1)
  })

  it('une carte en réapprentissage n’est pas maîtrisée, même avec une forte stabilité', () => {
    const long = goodStreak('m', '2026-01-01T10:00:00Z', 6)
    const lapse = [...long, rv('m', new Date(stateFromReviews(long).due.getTime() + 1000).toISOString(), 1)]
    const s = stateFromReviews(lapse)
    expect(isMastered(s)).toBe(false)
  })

  it('prochaine échéance : la plus proche à venir, null si aucune carte vue', () => {
    expect(homeStats([card('a')], [], now).nextDueAt).toBeNull()
    const s = homeStats([card('a')], [rv('a', ago(1))], now)
    expect(s.nextDueAt!.getTime()).toBeGreaterThan(now.getTime())
  })
})

describe('homeStats : tags', () => {
  it('les 8 tags dans l’ordre de shared/tags.ts ; une carte à 2 tags compte dans les deux ; tags vides à 0', () => {
    const s = homeStats(
      [card('a', ['ia', 'dev']), card('b', ['ia']), card('c', ['ia', 'ia']), card('d', ['dev'], { deleted_at: '2026-10-02T00:00:00Z' })],
      [], now,
    )
    expect(s.tags.map(t => t.slug)).toEqual(TAGS.map(t => t.slug))
    const count = Object.fromEntries(s.tags.map(t => [t.slug, t.count]))
    expect(count).toMatchObject({ ia: 3, dev: 1, securite: 0, culture: 0 })
  })

  it('cache ancien sans `tags` : ignoré sans erreur', () => {
    const s = homeStats([card('a', null as unknown as string[])], [], now)
    expect(s.tags.every(t => t.count === 0)).toBe(true)
  })
})

describe('libellés', () => {
  it.each([[0, '0 carte'], [1, '1 carte'], [2, '2 cartes'], [12, '12 cartes']])('%i → « %s »', (n, label) => {
    expect(cardsLabel(n)).toBe(label)
  })
  it('phrase du bloc principal accordée', () => {
    expect(`1 ${todaySuffix(1)}`).toBe("1 carte à revoir aujourd'hui")
    expect(`12 ${todaySuffix(12)}`).toBe("12 cartes à revoir aujourd'hui")
  })
})
