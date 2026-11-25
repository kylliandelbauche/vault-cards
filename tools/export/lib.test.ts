import { describe, expect, it } from 'vitest'
import { cardLine, deviceFiles, formatFile, isoMillis, reviewLine, type CardRow, type ReviewRow } from './lib.ts'

const device = '0f8c1c2e-1b7a-4c1e-9d55-3f1b2a4c5d6e'

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: 'c1', source: 'vault', status: 'active', front: 'Q / é', back: 'R', tags: ['IA'], deleted_at: null,
  created_at: '2026-10-12T08:00:00+00:00', updated_at: '2026-11-25T13:16:29.123456+00:00', deck: 'IA',
  source_path: '3-Resources/Second cerveau/IA.md', source_title: 'IA', ...over,
})
const review = (id: string, reviewed_at: string, rating = 3): ReviewRow => ({ id, card_id: 'c1', rating, reviewed_at })

describe('isoMillis', () => {
  it('ramène les horodatages Postgres au format du fichier, fraction tronquée', () => {
    expect(isoMillis('2026-11-25T13:16:29.123456+00:00')).toBe('2026-11-25T13:16:29.123Z')
    expect(isoMillis('2026-11-25T13:16:29.9+00:00')).toBe('2026-11-25T13:16:29.900Z')
    expect(isoMillis('2026-11-25 13:16:29+00')).toBe('2026-11-25T13:16:29.000Z')
    expect(isoMillis('2026-11-25T13:16:29.123Z')).toBe('2026-11-25T13:16:29.123Z')
  })
  it('refuse un autre fuseau ou une date impossible', () => {
    expect(() => isoMillis('2026-11-25T13:16:29+01:00')).toThrow()
    expect(() => isoMillis('2026-02-30T00:00:00Z')).toThrow()
    expect(() => isoMillis('hier')).toThrow()
  })
})

describe('lignes', () => {
  it('écrit une carte avec toutes ses clés, dans le format lu par l’app', () => {
    expect(cardLine(card({ source: 'manual', deck: null, source_path: null, source_title: null, deleted_at: '2026-11-26T00:00:00+00:00' })))
      .toBe('{"at":"2026-11-25T13:16:29.123Z","back":"R","created_at":"2026-10-12T08:00:00.000Z","deck":null,'
        + '"deleted_at":"2026-11-26T00:00:00.000Z","front":"Q / é","id":"c1","source":"manual","source_path":null,'
        + '"source_title":null,"status":"active","tags":["IA"],"v":1}')
  })
  it('écrit une révision, free à false', () => {
    expect(reviewLine(review('r1', '2026-11-25T13:16:29.123+00:00', 2)))
      .toBe('{"card_id":"c1","free":false,"id":"r1","rating":2,"reviewed_at":"2026-11-25T13:16:29.123Z","v":1}')
    expect(() => reviewLine(review('r1', '2026-11-25T13:16:29Z', 4))).toThrow()
  })
})

describe('deviceFiles', () => {
  it('range les révisions par mois UTC, dans l’ordre', () => {
    const files = deviceFiles(device, new Date('2026-12-01T10:00:00.000Z'), [card()], [
      review('r3', '2026-12-01T00:00:00+00:00'),
      review('r2', '2026-11-30T23:59:59.999+00:00'),
      review('r1', '2026-11-30T23:59:59.999+00:00'),
    ])
    expect(files.map(f => f.path)).toEqual([
      `devices/${device}/device.json`, `devices/${device}/cards.jsonl`,
      `devices/${device}/reviews-2026-11.jsonl`, `devices/${device}/reviews-2026-12.jsonl`,
    ])
    expect(files[0].contents).toBe(`{"created_at":"2026-12-01T10:00:00.000Z","id":"${device}","name":"Import de la PWA"}\n`)
    expect(files[2].contents.split('\n').filter(Boolean).map(l => JSON.parse(l).id)).toEqual(['r1', 'r2'])
    expect(files.every(f => f.contents.endsWith('\n'))).toBe(true)
  })
  it('refuse une révision sans carte et un id d’appareil invalide', () => {
    expect(() => deviceFiles(device, new Date(), [], [review('r1', '2026-11-25T00:00:00Z')])).toThrow(/carte inconnue/)
    expect(() => deviceFiles('IMPORT', new Date(), [], [])).toThrow(/appareil/)
  })
})

describe('formatFile', () => {
  it('crée format.json, accepte le v1 existant, refuse le reste', () => {
    expect(formatFile(null)).toEqual({ path: 'format.json', contents: '{"format":"vault-cards","version":1}\n' })
    expect(formatFile('{"format":"vault-cards","version":1}\n')).toBeNull()
    expect(() => formatFile('{"format":"vault-cards","version":2}')).toThrow(/version 2/)
    expect(() => formatFile('{"format":"autre","version":1}')).toThrow()
    expect(() => formatFile('{')).toThrow(/illisible/)
  })
})
