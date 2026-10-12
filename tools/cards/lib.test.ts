// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listSyntheses, hashContent, diffCards, validatePayload, computeScan } from './lib.ts'

const root = path.join(import.meta.dirname, 'fixtures')

describe('listSyntheses', () => {
  it('ne garde que les *-synthese.md, avec le deck = 1er sous-dossier', async () => {
    const notes = await listSyntheses(root, 'veille')
    expect(notes.map(n => [n.source_path, n.deck]).sort()).toEqual([
      ['veille/ia/a/a-synthese.md', 'ia'],
      ['veille/software/b/b-synthese.md', 'software'],
    ])
  })

  it('hash du contenu et chemin absolu lisible', async () => {
    const notes = await listSyntheses(root, 'veille')
    const a = notes.find(n => n.deck === 'ia')!
    const text = await fs.readFile(a.abs_path, 'utf8')
    expect(a.content_hash).toBe(hashContent(text))
  })

  it('accepte un nom de fichier qui commence par un emoji + espace', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-cards-'))
    try {
      const dir = path.join(tmp, '3-Resources/veille/software/x')
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, '🛡️ x-synthese.md'), 'contenu')
      await fs.writeFile(path.join(dir, 'x-transcription.md'), 'brut')
      const notes = await listSyntheses(tmp)
      expect(notes).toHaveLength(1)
      expect(notes[0].source_path).toBe('3-Resources/veille/software/x/🛡️ x-synthese.md')
      expect(notes[0].deck).toBe('software')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('hashContent', () => {
  it('stable et sensible au contenu', () => {
    expect(hashContent('x')).toBe(hashContent('x'))
    expect(hashContent('x')).not.toBe(hashContent('y'))
  })
  it('sha256 hex', () => {
    expect(hashContent('x')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('diffCards', () => {
  const existing = [{ id: '1', front: 'Q1', back: 'R1' }, { id: '2', front: 'Q2', back: 'R2' }]
  it('carte gardée telle quelle : ni update ni delete (progression conservée)', () => {
    const d = diffCards(existing, [{ id: '1', front: 'Q1', back: 'R1' }])
    expect(d).toEqual({ toInsert: [], toUpdate: [], toDelete: ['2'] })
  })
  it('carte gardée mais reformulée : update avec le même id', () => {
    const d = diffCards(existing, [{ id: '1', front: 'Q1 bis', back: 'R1' }, { id: '2', front: 'Q2', back: 'R2' }])
    expect(d.toUpdate).toEqual([{ id: '1', front: 'Q1 bis', back: 'R1' }])
    expect(d.toDelete).toEqual([])
  })
  it('nouvelle carte sans id : insert', () => {
    expect(diffCards([], [{ front: 'Q', back: 'R' }]).toInsert).toHaveLength(1)
  })
  it('id inconnu : erreur (Claude ne doit pas inventer d’id)', () => {
    expect(() => diffCards(existing, [{ id: '999', front: 'Q', back: 'R' }])).toThrow(/id inconnu/)
  })
  it('même id deux fois : erreur', () => {
    expect(() => diffCards(existing, [
      { id: '1', front: 'Q1', back: 'R1' },
      { id: '1', front: 'Q1 bis', back: 'R1' },
    ])).toThrow(/id en double/)
  })
  it('liste vide : toutes les cartes existantes supprimées', () => {
    expect(diffCards(existing, [])).toEqual({ toInsert: [], toUpdate: [], toDelete: ['1', '2'] })
  })
})

describe('validatePayload', () => {
  it('refuse une carte vide ou trop longue', () => {
    const base = { source_path: 'a.md', deck: 'ia', content_hash: 'h' }
    expect(() => validatePayload({ ...base, cards: [{ front: '', back: 'R' }] })).toThrow()
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'x'.repeat(1501) }] })).toThrow()
  })
  it('accepte une liste vide (note sans contenu à apprendre)', () => {
    expect(validatePayload({ source_path: 'a.md', deck: 'ia', content_hash: 'h', cards: [] }).cards).toEqual([])
  })
  it('trim le texte et garde l’id', () => {
    const p = validatePayload({ source_path: 'a.md', deck: 'ia', content_hash: 'h', cards: [{ id: 'u1', front: '  Q ', back: 'R\n' }] })
    expect(p.cards).toEqual([{ id: 'u1', front: 'Q', back: 'R' }])
  })
  it('refuse un payload mal formé avec un message lisible', () => {
    expect(() => validatePayload(null)).toThrow(/payload/)
    expect(() => validatePayload({ source_path: 'a.md', deck: 'ia', cards: [] })).toThrow(/content_hash/)
    expect(() => validatePayload({ source_path: 'a.md', deck: 'ia', content_hash: 'h', cards: 'x' })).toThrow(/cards/)
    expect(() => validatePayload({ source_path: 'a.md', deck: 'ia', content_hash: 'h', cards: [{ id: 3, front: 'Q', back: 'R' }] })).toThrow(/id/)
  })
})

describe('computeScan', () => {
  const file = (source_path: string, content_hash: string) =>
    ({ source_path, deck: 'ia', content_hash, abs_path: '/v/' + source_path })
  it('changed = notes nouvelles ou au hash différent ; removed = notes absentes du disque', () => {
    const files = [file('a.md', 'h1'), file('b.md', 'h2'), file('c.md', 'h3')]
    const rows = [
      { source_path: 'a.md', content_hash: 'h1' },
      { source_path: 'b.md', content_hash: 'old' },
      { source_path: 'gone.md', content_hash: 'h9' },
    ]
    const s = computeScan(files, rows)
    expect(s.changed.map(f => f.source_path)).toEqual(['b.md', 'c.md'])
    expect(s.removed).toEqual(['gone.md'])
  })
  it('une note déjà marquée "removed" n’est plus signalée', () => {
    expect(computeScan([], [{ source_path: 'gone.md', content_hash: 'removed' }]).removed).toEqual([])
  })
  it('une note marquée "removed" qui réapparaît est changed', () => {
    const s = computeScan([file('gone.md', 'h1')], [{ source_path: 'gone.md', content_hash: 'removed' }])
    expect(s.changed.map(f => f.source_path)).toEqual(['gone.md'])
  })
})
