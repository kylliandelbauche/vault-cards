import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VaultDB } from './db'
import { CardValidationError } from './cards'
import { acceptAll, acceptDraft, listDrafts, rejectDraft, updateDraft } from './drafts'
import { buildQueue } from './session'
import { homeStats } from './home'
import { pendingCount } from './sync'
import type { Card } from './types'

let db: VaultDB
beforeEach(() => { db = new VaultDB('test-' + crypto.randomUUID()) })
afterEach(async () => { await db.delete() })

const NOW = new Date('2026-10-15T10:00:00.000Z')
const opts = { now: () => NOW }

/** Brouillon tel que tiré du serveur (pas de champ `synced`). */
const draft = (id: string, inbox_id = 'i1', extra: Partial<Card> = {}): Card => ({
  id, source: 'inbox', status: 'draft', inbox_id, deck: null, source_path: null, source_title: 'Doc', tags: ['ia'],
  front: `Q ${id}`, back: `R ${id}`, created_at: `2026-10-15T09:00:0${id.length}.000Z`, updated_at: '2026-10-15T09:00:00.000Z', deleted_at: null, ...extra,
})

describe('brouillons (#55)', () => {
  it('listDrafts : brouillons vivants, par élément, dans l’ordre de création ; ni acceptés, ni rejetés, ni autres sources', async () => {
    await db.cards.bulkAdd([
      draft('b'), draft('a'), draft('autre', 'i2'),
      draft('ok', 'i1', { status: 'active' }), draft('rejete', 'i1', { deleted_at: 't' }),
      { ...draft('m'), source: 'manual', status: undefined, inbox_id: null },
    ])
    expect((await listDrafts(db)).map(c => c.id)).toEqual(['a', 'b', 'autre'])
    expect((await listDrafts(db, 'i1')).map(c => c.id)).toEqual(['a', 'b'])
  })

  it('acceptDraft : passe en active (avec retouches validées), à envoyer ; entre alors dans les sessions et compteurs', async () => {
    await db.cards.add(draft('d'))
    expect(buildQueue(await db.cards.toArray(), [], NOW)).toHaveLength(0)
    expect(homeStats(await db.cards.toArray(), [], NOW).total).toBe(0)

    const card = await acceptDraft(db, 'd', { front: '  Q corrigée ', tags: ['dev'] }, opts)

    expect(card).toMatchObject({ status: 'active', front: 'Q corrigée', back: 'R d', tags: ['dev'], updated_at: NOW.toISOString(), synced: 0 })
    expect(await db.cards.get('d')).toEqual(card)
    expect(buildQueue(await db.cards.toArray(), [], NOW).map(i => i.card.id)).toEqual(['d'])
    expect(await pendingCount(db)).toBe(1)
  })

  it('acceptDraft : retouche invalide refusée, rien n’est écrit ; carte non brouillon refusée', async () => {
    await db.cards.bulkAdd([draft('d'), draft('ok', 'i1', { status: 'active' }), { ...draft('m'), source: 'manual', status: undefined }])
    await expect(acceptDraft(db, 'd', { tags: [] }, opts)).rejects.toBeInstanceOf(CardValidationError)
    expect((await db.cards.get('d'))!.status).toBe('draft')
    await expect(acceptDraft(db, 'ok', undefined, opts)).rejects.toThrow('brouillon introuvable')
    await expect(acceptDraft(db, 'm', undefined, opts)).rejects.toThrow('brouillon introuvable')
    await expect(acceptDraft(db, 'absent', undefined, opts)).rejects.toThrow('brouillon introuvable')
  })

  it('updateDraft : retouche sans accepter (reste brouillon, à envoyer)', async () => {
    await db.cards.add(draft('d'))
    const card = await updateDraft(db, 'd', { back: 'Nouvelle' }, opts)
    expect(card).toMatchObject({ status: 'draft', back: 'Nouvelle', synced: 0 })
  })

  it('rejectDraft : suppression douce, à envoyer ; plus listé', async () => {
    await db.cards.add(draft('d'))
    await rejectDraft(db, 'd', opts)
    expect(await db.cards.get('d')).toMatchObject({ status: 'draft', deleted_at: NOW.toISOString(), synced: 0 })
    expect(await listDrafts(db)).toEqual([])
    await expect(rejectDraft(db, 'd', opts)).rejects.toThrow('brouillon introuvable')
  })

  it('acceptAll : tous les brouillons (ou ceux d’un élément) passent en active, en une transaction', async () => {
    await db.cards.bulkAdd([draft('a'), draft('b'), draft('c', 'i2')])
    expect(await acceptAll(db, 'i1', opts)).toBe(2)
    expect((await listDrafts(db)).map(c => c.id)).toEqual(['c'])
    expect(await acceptAll(db, undefined, opts)).toBe(1)
    expect(await listDrafts(db)).toEqual([])
    expect((await db.cards.toArray()).every(c => c.status === 'active' && c.synced === 0)).toBe(true)
  })
})
