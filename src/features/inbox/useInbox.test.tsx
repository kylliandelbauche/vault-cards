import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { VaultDB } from '../../lib/db'
import { pendingCount } from '../../lib/sync'
import type { InboxClient } from '../../lib/inbox'
import type { Card } from '../../lib/types'
import { useDrafts } from './useDrafts'
import { useInbox } from './useInbox'

let db: VaultDB | undefined
afterEach(async () => { db?.close(); if (db) await db.delete(); db = undefined })

const draft = (id: string, inbox_id: string): Card => ({
  id, source: 'inbox', status: 'draft', inbox_id, deck: null, source_path: null, tags: ['ia'], front: id, back: id,
  created_at: `2026-10-15T09:00:00.00${id.length}Z`, updated_at: 't', deleted_at: null,
})

describe('useDrafts', () => {
  it('liste en direct les brouillons de l’élément ; accept / reject / acceptAll écrivent en local et appellent onWrite', async () => {
    db = new VaultDB(`drafts-${crypto.randomUUID()}`)
    await db.cards.bulkAdd([draft('a', 'i1'), draft('bb', 'i1'), draft('ccc', 'i1'), draft('x', 'i2')])
    const onWrite = vi.fn()
    const { result } = renderHook(() => useDrafts(db!, 'i1', { onWrite }))
    await waitFor(() => expect(result.current.drafts?.map(c => c.id)).toEqual(['a', 'bb', 'ccc']))

    await act(async () => { await result.current.accept('a', { front: 'A corrigée' }) })
    await act(async () => { await result.current.reject('bb') })
    await waitFor(() => expect(result.current.drafts?.map(c => c.id)).toEqual(['ccc']))
    await act(async () => { expect(await result.current.acceptAll()).toBe(1) })
    await waitFor(() => expect(result.current.drafts).toEqual([]))

    expect(onWrite).toHaveBeenCalledTimes(3)
    expect(await pendingCount(db)).toBe(3)
    expect((await db.cards.get('x'))!.status).toBe('draft')
  })
})

describe('useInbox', () => {
  it('lit les statuts au montage ; un dépôt relit la liste ; une lecture en échec est exposée', async () => {
    let rows = [{ id: '1', status: 'done' }]
    const limit = vi.fn(async () => ({ data: rows, error: null as null | { message: string } }))
    const q = { select: () => q, order: () => q, limit }
    const client = {
      from: () => q,
      rpc: vi.fn(async () => ({ data: { id: '2', status: 'pending' }, error: null })),
    } as unknown as InboxClient
    const { result } = renderHook(() => useInbox({ client, online: () => true, uuid: () => '2' }))
    await waitFor(() => expect(result.current.items?.map(i => i.id)).toEqual(['1']))

    rows = [{ id: '2', status: 'pending' }, { id: '1', status: 'done' }]
    await act(async () => { await result.current.addText('Bonjour') })
    await waitFor(() => expect(result.current.items?.map(i => i.id)).toEqual(['2', '1']))

    limit.mockResolvedValueOnce({ data: null as never, error: { message: 'Failed to fetch' } })
    await act(async () => { await result.current.refresh() })
    expect(result.current.error?.message).toContain('Failed to fetch')
    expect(result.current.items?.map(i => i.id)).toEqual(['2', '1'])
  })
})
