import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { CardValidationError } from '../../lib/cards'
import { VaultDB } from '../../lib/db'
import { pendingCount } from '../../lib/sync'
import { useManualCards } from './useManualCards'

let db: VaultDB
afterEach(async () => { db?.close(); if (db) await db.delete() })

describe('useManualCards', () => {
  it('liste en direct les cartes manuelles vivantes (plus récente d’abord) ; create / update / remove écrivent en local et appellent onWrite', async () => {
    db = new VaultDB(`manual-${crypto.randomUUID()}`)
    await db.cards.add({ id: 'v', source: 'vault', deck: 'd', source_path: 'd/v.md', tags: ['ia'], front: 'V', back: 'V', updated_at: 't', deleted_at: null })
    const onWrite = vi.fn()
    let t = Date.parse('2026-10-14T10:00:00Z')
    const now = () => new Date((t += 1000))
    const { result } = renderHook(() => useManualCards(db, { onWrite, now }))
    await waitFor(() => expect(result.current.cards).toEqual([]))

    let a = '', b = ''
    await act(async () => { a = (await result.current.create({ front: 'A', back: 'R', tags: ['ia'] })).id })
    await act(async () => { b = (await result.current.create({ front: 'B', back: 'R', tags: ['dev'] })).id })
    await waitFor(() => expect(result.current.cards?.map(c => c.front)).toEqual(['B', 'A']))

    await act(async () => { await result.current.update(a, { front: 'A2' }) })
    await waitFor(() => expect(result.current.cards?.map(c => c.front)).toEqual(['A2', 'B']))

    await act(async () => { await result.current.remove(b) })
    await waitFor(() => expect(result.current.cards?.map(c => c.id)).toEqual([a]))

    expect(onWrite).toHaveBeenCalledTimes(4)
    expect(await pendingCount(db)).toBe(2) // a (créée puis modifiée) et b (supprimée) restent à envoyer
  })

  it('saisie invalide : rejette avec CardValidationError, n’écrit rien et n’appelle pas onWrite', async () => {
    db = new VaultDB(`manual-${crypto.randomUUID()}`)
    const onWrite = vi.fn()
    const { result } = renderHook(() => useManualCards(db, { onWrite }))
    await waitFor(() => expect(result.current.cards).toEqual([]))
    await act(async () => {
      await expect(result.current.create({ front: 'Q', back: 'R', tags: [] })).rejects.toBeInstanceOf(CardValidationError)
    })
    expect(onWrite).not.toHaveBeenCalled()
    expect(await db.cards.count()).toBe(0)
  })
})
