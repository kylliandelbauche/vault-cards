// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listSyntheses, hashContent, diffCards, validatePayload, assertDeckMatchesPath, computeScan, validateRetagPayload, planRetag } from './lib.ts'

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
  const existing = [
    { id: '1', front: 'Q1', back: 'R1', tags: ['ia'] },
    { id: '2', front: 'Q2', back: 'R2', tags: ['dev'] },
  ]
  it('carte gardée telle quelle : ni update ni delete (progression conservée)', () => {
    const d = diffCards(existing, [{ id: '1', front: 'Q1', back: 'R1', tags: ['ia'] }])
    expect(d).toEqual({ toInsert: [], toUpdate: [], toDelete: ['2'] })
  })
  it('carte gardée mais reformulée : update avec le même id', () => {
    const d = diffCards(existing, [
      { id: '1', front: 'Q1 bis', back: 'R1', tags: ['ia'] },
      { id: '2', front: 'Q2', back: 'R2', tags: ['dev'] },
    ])
    expect(d.toUpdate).toEqual([{ id: '1', front: 'Q1 bis', back: 'R1', tags: ['ia'] }])
    expect(d.toDelete).toEqual([])
  })
  it('seul changement = tags : update avec le même id', () => {
    const d = diffCards(existing, [
      { id: '1', front: 'Q1', back: 'R1', tags: ['ia', 'securite'] },
      { id: '2', front: 'Q2', back: 'R2', tags: ['dev'] },
    ])
    expect(d).toEqual({ toInsert: [], toUpdate: [{ id: '1', front: 'Q1', back: 'R1', tags: ['ia', 'securite'] }], toDelete: [] })
  })
  it('nouvelle carte sans id : insert avec ses tags', () => {
    expect(diffCards([], [{ front: 'Q', back: 'R', tags: ['culture'] }]).toInsert).toEqual([{ front: 'Q', back: 'R', tags: ['culture'] }])
  })
  it('id inconnu : erreur (Claude ne doit pas inventer d’id)', () => {
    expect(() => diffCards(existing, [{ id: '999', front: 'Q', back: 'R', tags: ['ia'] }])).toThrow(/id inconnu/)
  })
  it('même id deux fois : erreur', () => {
    expect(() => diffCards(existing, [
      { id: '1', front: 'Q1', back: 'R1', tags: ['ia'] },
      { id: '1', front: 'Q1 bis', back: 'R1', tags: ['ia'] },
    ])).toThrow(/id en double/)
  })
  it('liste vide : toutes les cartes existantes supprimées', () => {
    expect(diffCards(existing, [])).toEqual({ toInsert: [], toUpdate: [], toDelete: ['1', '2'] })
  })
})

describe('validatePayload', () => {
  const base = { source_path: 'a.md', deck: 'ia', content_hash: 'h' }
  it('refuse une carte vide ou trop longue', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: '', back: 'R', tags: ['ia'] }] })).toThrow()
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'x'.repeat(1501), tags: ['ia'] }] })).toThrow()
  })
  it('accepte une liste vide (note sans contenu à apprendre)', () => {
    expect(validatePayload({ ...base, cards: [] }).cards).toEqual([])
  })
  it('trim le texte, garde l’id et les tags', () => {
    const p = validatePayload({ ...base, cards: [{ id: 'u1', front: '  Q ', back: 'R\n', tags: ['ia', 'dev'] }] })
    expect(p.cards).toEqual([{ id: 'u1', front: 'Q', back: 'R', tags: ['ia', 'dev'] }])
  })
  it('refuse un payload mal formé avec un message lisible', () => {
    expect(() => validatePayload(null)).toThrow(/payload/)
    expect(() => validatePayload({ source_path: 'a.md', deck: 'ia', cards: [] })).toThrow(/content_hash/)
    expect(() => validatePayload({ ...base, cards: 'x' })).toThrow(/cards/)
    expect(() => validatePayload({ ...base, cards: [{ id: 3, front: 'Q', back: 'R', tags: ['ia'] }] })).toThrow(/id/)
  })
  it('tags : slug inconnu refusé', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['cuisine'] }] })).toThrow(/tag inconnu/)
  })
  it('tags : 0 tag refusé (absent ou liste vide)', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R' }] })).toThrow(/tags/)
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: [] }] })).toThrow(/tags/)
  })
  it('tags : 3 tags refusés', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['ia', 'dev', 'culture'] }] })).toThrow(/tags/)
  })
  it('tags : doublon refusé', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['ia', 'ia'] }] })).toThrow(/double/)
  })
  it('clé inconnue sur une carte : refusée, la clé est nommée (ex. ID au lieu de id)', () => {
    expect(() => validatePayload({ ...base, cards: [{ ID: 'u1', front: 'Q', back: 'R', tags: ['ia'] }] })).toThrow(/carte 1.*« ID »/)
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['ia'] }, { front: 'Q', back: 'R', tags: ['ia'], extra: 1 }] }))
      .toThrow(/carte 2.*« extra »/)
  })
  it('clé inconnue au niveau payload : refusée, la clé est nommée', () => {
    expect(() => validatePayload({ ...base, Deck: 'x', cards: [] })).toThrow(/payload.*« Deck »/)
  })
})

describe('assertDeckMatchesPath', () => {
  it('deck = dossier qui suit veille/ dans source_path', () => {
    expect(() => assertDeckMatchesPath('3-Resources/veille/software/x/x-synthese.md', 'software')).not.toThrow()
    expect(() => assertDeckMatchesPath('veille/ia/a-synthese.md', 'ia')).not.toThrow()
  })
  it('deck différent : erreur qui nomme le deck attendu', () => {
    expect(() => assertDeckMatchesPath('3-Resources/veille/software/x/x-synthese.md', 'ia')).toThrow(/deck « ia ».*« software »/)
  })
  it('deck sensible à la casse et au sous-dossier', () => {
    expect(() => assertDeckMatchesPath('veille/ia/a/a-synthese.md', 'IA')).toThrow(/deck/)
    expect(() => assertDeckMatchesPath('veille/ia/a/a-synthese.md', 'a')).toThrow(/deck/)
  })
  it('chemin sans dossier veille/ + deck : erreur', () => {
    expect(() => assertDeckMatchesPath('a.md', 'ia')).toThrow(/veille/)
    expect(() => assertDeckMatchesPath('veille/a-synthese.md', 'ia')).toThrow(/veille/)
  })
})

describe('validateRetagPayload', () => {
  it('accepte une liste de {id, tags} et ignore tout autre champ (jamais le texte)', () => {
    const p = validateRetagPayload([{ id: 'u1', tags: ['ia'], front: 'ignoré' }, { id: 'u2', tags: ['dev', 'securite'] }])
    expect(p).toEqual([{ id: 'u1', tags: ['ia'] }, { id: 'u2', tags: ['dev', 'securite'] }])
  })
  it('refuse : pas une liste, id manquant, id en double, tags invalides', () => {
    expect(() => validateRetagPayload({ id: 'u1', tags: ['ia'] })).toThrow(/liste/)
    expect(() => validateRetagPayload([{ tags: ['ia'] }])).toThrow(/id/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: ['ia'] }, { id: 'u1', tags: ['dev'] }])).toThrow(/id en double/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: ['cuisine'] }])).toThrow(/tag inconnu/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: [] }])).toThrow(/tags/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: ['ia', 'dev', 'culture'] }])).toThrow(/tags/)
  })
})

describe('planRetag', () => {
  const existing = [
    { id: 'u1', tags: [], deleted_at: null },
    { id: 'u2', tags: ['dev'], deleted_at: null },
    { id: 'u3', tags: ['ia'], deleted_at: '2026-10-12T00:00:00Z' },
  ]
  it('ne met à jour que les cartes dont les tags changent', () => {
    expect(planRetag(existing, [{ id: 'u1', tags: ['ia'] }, { id: 'u2', tags: ['dev'] }]))
      .toEqual({ toUpdate: [{ id: 'u1', tags: ['ia'] }], unchanged: 1 })
  })
  it('id inconnu : erreur avant toute écriture', () => {
    expect(() => planRetag(existing, [{ id: 'u1', tags: ['ia'] }, { id: 'u9', tags: ['ia'] }])).toThrow(/id inconnu: u9/)
  })
  it('id d’une carte supprimée : erreur avant toute écriture', () => {
    expect(() => planRetag(existing, [{ id: 'u1', tags: ['ia'] }, { id: 'u3', tags: ['dev'] }])).toThrow(/carte supprimée: u3/)
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
