import { describe, it, expect } from 'vitest'
import { SAMPLE_CARDS } from './sample-cards'

describe('SAMPLE_CARDS', () => {
  it('12 cartes vivantes, ids uniques sample-<i>', () => {
    expect(SAMPLE_CARDS).toHaveLength(12)
    expect(SAMPLE_CARDS.map(c => c.id)).toEqual(Array.from({ length: 12 }, (_, i) => `sample-${i}`))
    expect(SAMPLE_CARDS.every(c => c.deleted_at === null)).toBe(true)
  })
  it('deck = premier segment du chemin source', () => {
    for (const c of SAMPLE_CARDS) expect(c.deck).toBe(c.source_path!.split('/')[0])
  })
  it('texte brut, sans HTML', () => {
    for (const c of SAMPLE_CARDS) expect(`${c.front}${c.back}`).not.toMatch(/<[a-z/]/i)
  })
})
