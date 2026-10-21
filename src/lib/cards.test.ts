import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VaultDB } from './db'
import { CardValidationError, createManualCard, deleteManualCard, FRONT_MAX, BACK_MAX, updateCard, validateManualCard } from './cards'
import { buildQueue } from './session'
import { homeStats } from './home'
import { pendingCount } from './sync'

let db: VaultDB
beforeEach(() => { db = new VaultDB('test-' + crypto.randomUUID()) })
afterEach(async () => { await db.delete() })

const NOW = new Date('2026-10-14T10:00:00.000Z')
const opts = (id = '11111111-1111-4111-8111-111111111111') => ({ now: () => NOW, uuid: () => id })

describe('validateManualCard', () => {
  it('trim question et réponse, garde l’ordre des tags (le 1er est le principal)', () => {
    expect(validateManualCard({ front: '  Q ?  ', back: '\nR.\n', tags: ['dev', 'ia'] })).toEqual({ front: 'Q ?', back: 'R.', tags: ['dev', 'ia'] })
  })

  it.each([
    [{ front: '   ', back: 'R', tags: ['ia'] }, 'front'],
    [{ front: 'Q', back: '', tags: ['ia'] }, 'back'],
    [{ front: 'x'.repeat(FRONT_MAX + 1), back: 'R', tags: ['ia'] }, 'front'],
    [{ front: 'Q', back: 'x'.repeat(BACK_MAX + 1), tags: ['ia'] }, 'back'],
    [{ front: 'Q', back: 'R', tags: [] }, 'tags'],
    [{ front: 'Q', back: 'R', tags: ['ia', 'dev', 'culture'] }, 'tags'],
    [{ front: 'Q', back: 'R', tags: ['inconnu'] }, 'tags'],
    [{ front: 'Q', back: 'R', tags: ['ia', 'ia'] }, 'tags'],
  ])('%o refusée sur le champ %s', (input, field) => {
    let err: unknown
    try { validateManualCard(input) } catch (e) { err = e }
    expect(err).toBeInstanceOf(CardValidationError)
    expect((err as CardValidationError).field).toBe(field)
  })

  it.each([
    ['caractère NUL', 'Q\u0000?', 'front'],
    ['surrogate haut isolé', 'Q \ud83d', 'front'],
    ['surrogate bas isolé', '\udc00 R', 'back'],
  ])('%s refusé (Postgres le rejetterait à chaque envoi)', (_label, text, field) => {
    const input = { front: 'Q', back: 'R', tags: ['ia'], [field]: text }
    let err: unknown
    try { validateManualCard(input) } catch (e) { err = e }
    expect(err).toBeInstanceOf(CardValidationError)
    expect((err as CardValidationError).field).toBe(field)
  })

  it('emojis (paires de surrogates complètes), accents et retours à la ligne acceptés', () => {
    expect(validateManualCard({ front: 'Q 🧠 é\nsuite', back: 'R 👍🏽', tags: ['ia'] }).front).toBe('Q 🧠 é\nsuite')
  })

  it('longueurs comptées en caractères (points de code) comme char_length en SQL : 500 emojis passent', () => {
    expect(validateManualCard({ front: '🧠'.repeat(FRONT_MAX), back: 'R', tags: ['mental'] }).front).toHaveLength(FRONT_MAX * 2)
  })
})

describe('createManualCard', () => {
  it('hors ligne : écrite tout de suite dans Dexie, à envoyer, UUID client, sans deck ni source_path', async () => {
    const card = await createManualCard(db, { front: ' Q ', back: ' R ', tags: ['ia'] }, opts())
    expect(card).toEqual({
      id: '11111111-1111-4111-8111-111111111111', source: 'manual', deck: null, source_path: null, source_title: null,
      tags: ['ia'], front: 'Q', back: 'R', created_at: NOW.toISOString(), updated_at: NOW.toISOString(), deleted_at: null, synced: 0,
    })
    expect(await db.cards.get(card.id)).toEqual(card)
    expect(await pendingCount(db)).toBe(1)
  })

  it('apparaît aussitôt dans la session du jour et les compteurs (nouvelle carte)', async () => {
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['dev'] }, opts())
    const cards = await db.cards.toArray()
    expect(buildQueue(cards, [], NOW).map(i => i.card.id)).toEqual([card.id])
    const stats = homeStats(cards, [], NOW)
    expect(stats.fresh).toBe(1)
    expect(stats.tags.find(t => t.name === 'dev')!.total).toBe(1)
  })

  it('UUID par défaut : crypto.randomUUID', async () => {
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] })
    expect(card.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('invalide : rien n’est écrit', async () => {
    await expect(createManualCard(db, { front: '', back: 'R', tags: ['ia'] }, opts())).rejects.toBeInstanceOf(CardValidationError)
    expect(await db.cards.count()).toBe(0)
  })
})

describe('updateCard', () => {
  it('modifie question, réponse ou tags (validés), repasse la carte à envoyer', async () => {
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] }, opts())
    await db.cards.update(card.id, { synced: 1 })
    const later = new Date('2026-10-14T11:00:00.000Z')
    const updated = await updateCard(db, card.id, { back: ' R2 ', tags: ['culture'] }, { now: () => later })
    expect(updated).toMatchObject({ front: 'Q', back: 'R2', tags: ['culture'], synced: 0, updated_at: later.toISOString() })
    expect(await db.cards.get(card.id)).toEqual(updated)
    await expect(updateCard(db, card.id, { front: ' ' })).rejects.toBeInstanceOf(CardValidationError)
    expect((await db.cards.get(card.id))!.front).toBe('Q')
  })

  it('refuse une carte vault, inconnue ou supprimée', async () => {
    await db.cards.add({ id: 'v', source: 'vault', deck: 'd', source_path: 'd/v.md', tags: ['ia'], front: 'Q', back: 'R', updated_at: 't', deleted_at: null })
    await expect(updateCard(db, 'v', { front: 'X' })).rejects.toThrow('carte manuelle introuvable')
    await expect(updateCard(db, 'nope', { front: 'X' })).rejects.toThrow('carte manuelle introuvable')
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] }, opts())
    await deleteManualCard(db, card.id)
    await expect(updateCard(db, card.id, { front: 'X' })).rejects.toThrow('carte manuelle introuvable')
    expect((await db.cards.get('v'))!.front).toBe('Q')
  })
})

describe('deleteManualCard', () => {
  it('suppression douce : deleted_at posé, carte à envoyer, sortie des sessions et compteurs', async () => {
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] }, opts())
    await db.cards.update(card.id, { synced: 1 })
    await deleteManualCard(db, card.id, { now: () => NOW })
    const stored = (await db.cards.get(card.id))!
    expect(stored).toMatchObject({ deleted_at: NOW.toISOString(), synced: 0, front: 'Q' })
    expect(buildQueue([stored], [], NOW)).toEqual([])
    expect(homeStats([stored], [], NOW).total).toBe(0)
  })

  it('refuse une carte vault ; supprimer deux fois est sans effet', async () => {
    await db.cards.add({ id: 'v', source: 'vault', deck: 'd', source_path: 'd/v.md', tags: ['ia'], front: 'Q', back: 'R', updated_at: 't', deleted_at: null })
    await expect(deleteManualCard(db, 'v')).rejects.toThrow('carte manuelle introuvable')
    expect((await db.cards.get('v'))!.deleted_at).toBeNull()
    const card = await createManualCard(db, { front: 'Q', back: 'R', tags: ['ia'] }, opts())
    await deleteManualCard(db, card.id, { now: () => NOW })
    await deleteManualCard(db, card.id, { now: () => new Date('2030-01-01T00:00:00.000Z') })
    expect((await db.cards.get(card.id))!.deleted_at).toBe(NOW.toISOString())
  })
})
