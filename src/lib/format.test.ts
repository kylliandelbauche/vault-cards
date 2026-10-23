import { describe, it, expect } from 'vitest'
import { formatAgo, formatInterval } from './format'

const t0 = new Date('2026-10-12T10:00:00Z')
const plus = (ms: number) => new Date(t0.getTime() + ms)
const MIN = 60_000, DAY = 86_400_000

describe('formatInterval', () => {
  it('moins d’une minute', () => expect(formatInterval(t0, plus(30_000))).toBe('< 1 min'))
  it('minutes', () => expect(formatInterval(t0, plus(10 * MIN))).toBe('10 min'))
  it('heures', () => expect(formatInterval(t0, plus(5 * 60 * MIN))).toBe('5 h'))
  it('jours', () => expect(formatInterval(t0, plus(3 * DAY))).toBe('3 j'))
  it('mois', () => expect(formatInterval(t0, plus(65 * DAY))).toBe('2 mois'))
  it('années', () => expect(formatInterval(t0, plus(440 * DAY))).toBe('1,2 an'))
  it('date passée', () => expect(formatInterval(t0, plus(-DAY))).toBe('< 1 min'))
})

describe('formatAgo', () => {
  const ago = (ms: number) => formatAgo(t0, plus(ms))
  it('sous la minute', () => expect(ago(30_000)).toBe("à l'instant"))
  it('minutes', () => { expect(ago(MIN)).toBe('il y a 1 min'); expect(ago(59 * MIN + 59_000)).toBe('il y a 59 min') })
  it('heures, arrondies vers le bas', () => { expect(ago(60 * MIN)).toBe('il y a 1 h'); expect(ago(170 * MIN)).toBe('il y a 2 h') })
  it('jours', () => { expect(ago(DAY)).toBe('il y a 1 j'); expect(ago(45 * DAY)).toBe('il y a 45 j') })
  it('date dans le futur (horloge en retard)', () => expect(ago(-DAY)).toBe("à l'instant"))
})
