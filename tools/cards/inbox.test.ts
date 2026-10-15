// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { claimPath, dedupKey, fileProblem, matchesSignature, parseInboxArgs, shortError, validateInboxPayload, INBOX_SOURCE, IMAGE_MAX } from './inbox.ts'

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap(p => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)))

describe('signature des octets', () => {
  it.each([
    ['application/pdf', bytes('%PDF-1.7\n...')],
    ['image/png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    ['image/jpeg', bytes([0xff, 0xd8, 0xff, 0xe0, 1, 2])],
    ['image/webp', bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 ')],
    ['text/plain', new TextEncoder().encode('Bonjour, ça va ? 😀')],
    ['text/markdown', new TextEncoder().encode('# Titre\n- point')],
  ])('%s reconnu', (mime, b) => {
    expect(matchesSignature(b, mime)).toBe(true)
    expect(fileProblem(b, mime, b.length)).toBeNull()
  })

  it.each([
    ['application/pdf', bytes('MZ\x90\x00 exécutable renommé')],
    ['image/png', bytes([0xff, 0xd8, 0xff, 0xe0])],
    ['image/jpeg', bytes('%PDF-1.4')],
    ['image/webp', bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt ')],
    ['text/plain', bytes([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])], // zip (octet nul)
    ['text/plain', bytes([0xc3, 0x28])], // UTF-8 invalide
    ['application/zip', bytes('PK')],
  ])('%s refusé quand le contenu ne correspond pas', (mime, b) => {
    expect(matchesSignature(b, mime)).toBe(false)
  })

  it('fileProblem : vide, taille différente, image trop grosse, format hors liste', () => {
    expect(fileProblem(new Uint8Array(), 'application/pdf', 0)).toBe('fichier vide')
    expect(fileProblem(bytes('%PDF-1'), 'application/pdf', 99)).toBe('taille différente de celle enregistrée')
    expect(fileProblem(new Uint8Array(IMAGE_MAX + 1), 'image/png', null)).toBe('fichier trop gros')
    expect(fileProblem(bytes('x'), 'application/zip', 1)).toBe('format refusé')
    expect(fileProblem(bytes('MZ'), 'application/pdf', 2)).toBe('contenu ne correspondant pas au format déclaré')
  })
})

describe('validateInboxPayload', () => {
  const ok = { source_title: ' Cours de chimie ', cards: [{ front: ' Q1 ? ', back: 'R1', tags: ['culture'] }, { front: 'Q2', back: 'R2', tags: ['ia', 'dev'] }] }

  it('normalise (trim) et garde l’ordre des tags ; liste vide permise', () => {
    expect(validateInboxPayload(ok)).toEqual({ source_title: 'Cours de chimie', cards: [{ front: 'Q1 ?', back: 'R1', tags: ['culture'] }, { front: 'Q2', back: 'R2', tags: ['ia', 'dev'] }] })
    expect(validateInboxPayload({ source_title: 'T', cards: [] }).cards).toEqual([])
  })

  it.each([
    [[], 'objet JSON attendu'],
    [{ ...ok, deck: 'x' }, 'clé inconnue « deck »'],
    [{ cards: [] }, '« source_title » doit être un texte non vide'],
    [{ source_title: 'x'.repeat(201), cards: [] }, 'trop long'],
    [{ source_title: 'T' }, '« cards » doit être une liste'],
    [{ source_title: 'T', cards: [{ id: 'x', front: 'Q', back: 'R', tags: ['ia'] }] }, 'clé inconnue « id »'],
    [{ source_title: 'T', cards: [{ front: '', back: 'R', tags: ['ia'] }] }, '« front » doit être un texte non vide'],
    [{ source_title: 'T', cards: [{ front: 'x'.repeat(501), back: 'R', tags: ['ia'] }] }, 'trop long'],
    [{ source_title: 'T', cards: [{ front: 'Q', back: 'x'.repeat(1501), tags: ['ia'] }] }, 'trop long'],
    [{ source_title: 'T', cards: [{ front: 'Q', back: 'R', tags: [] }] }, '1 à 2 tags'],
    [{ source_title: 'T', cards: [{ front: 'Q', back: 'R', tags: ['inconnu'] }] }, 'tag inconnu'],
    [{ source_title: 'T', cards: [{ front: 'Q', back: 'R', tags: ['ia', 'ia'] }] }, 'tag en double'],
    [{ source_title: 'T', cards: [{ front: 'Qu’est-ce que X ?', back: 'R', tags: ['ia'] }, { front: 'qu’est ce que x', back: 'R2', tags: ['ia'] }] }, 'doublon de la carte 1'],
    [{ source_title: 'T', cards: Array.from({ length: 51 }, (_, i) => ({ front: `Q${i}`, back: 'R', tags: ['ia'] })) }, '50 au maximum'],
  ])('%o refusé (%s)', (payload, message) => {
    expect(() => validateInboxPayload(payload)).toThrow(message)
  })

  it('dedupKey ignore casse, accents, ponctuation', () => {
    expect(dedupKey('  Pourquoi l’été ?')).toBe(dedupKey('pourquoi l ete'))
  })
})

describe('arguments et chemins', () => {
  const ID = '00000000-0000-4000-8000-000000000001'
  it('parseInboxArgs', () => {
    expect(parseInboxArgs(['list'])).toEqual({ action: 'list' })
    expect(parseInboxArgs(['purge'])).toEqual({ action: 'purge' })
    expect(parseInboxArgs(['claim', ID, '/tmp/run'])).toEqual({ action: 'claim', id: ID, dir: '/tmp/run' })
    expect(parseInboxArgs(['complete', ID, 'c.json'])).toEqual({ action: 'complete', id: ID, file: 'c.json' })
    expect(parseInboxArgs(['fail', ID, 'PDF', 'illisible'])).toEqual({ action: 'fail', id: ID, message: 'PDF illisible' })
    expect(() => parseInboxArgs(['claim', 'pas-un-uuid', '/tmp'])).toThrow('id invalide')
    expect(() => parseInboxArgs(['claim', ID, 'relatif'])).toThrow('dossier absolu')
    expect(() => parseInboxArgs(['fail', ID])).toThrow('message manquant')
    expect(() => parseInboxArgs(['list', 'x'])).toThrow('usage')
    expect(() => parseInboxArgs(['supprime'])).toThrow('usage')
  })

  it('claimPath : nommé par id et type, jamais par le nom de fichier de l’utilisateur', () => {
    expect(claimPath('/tmp/run', ID, 'file', 'application/pdf')).toBe(`/tmp/run/${ID}.pdf`)
    expect(claimPath('/tmp/run', ID, 'text', null)).toBe(`/tmp/run/${ID}.txt`)
    expect(() => claimPath('/tmp/run', ID, 'file', 'application/zip')).toThrow('format refusé')
  })

  it('shortError : une ligne, 300 caractères au plus', () => {
    expect(shortError(' a\n  b ')).toBe('a b')
    expect(Array.from(shortError('x'.repeat(400)))).toHaveLength(300)
  })
})

describe('inbox-cli.ts : jamais de carte vault ni manual', () => {
  it('toute lecture/modification de cards passe par inboxOnly, les insertions sont source inbox en brouillon', async () => {
    const cli = await fs.readFile(path.join(import.meta.dirname, 'inbox-cli.ts'), 'utf8')
    const uses = cli.match(/\.from\(\s*['"`]cards['"`]\s*\)/g) ?? []
    const filtered = cli.match(/inboxOnly\(db\.from\('cards'\)\.(select|update)\(/g) ?? []
    const inserts = cli.match(/db\.from\('cards'\)\.insert\(/g) ?? []
    expect(cli.match(/['"`]cards['"`]/g) ?? []).toHaveLength(uses.length)
    expect(cli).not.toMatch(/\.rpc\(/)
    expect(uses.length).toBeGreaterThan(0)
    expect(filtered.length + inserts.length).toBe(uses.length)
    expect(inserts.length).toBe(1)
    expect(cli).toMatch(/source: INBOX_SOURCE, status: 'draft'/)
    expect(INBOX_SOURCE).toBe('inbox')
  })
})
