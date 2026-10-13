import { describe, it, expect, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { VaultDB } from '../../lib/db'
import type { Card } from '../../lib/types'
import { useHomeData } from './useHomeData'

const card = (id: string, tags: string[]): Card => ({
  id, deck: 'x', tags, source_path: `x/${id}.md`, front: id, back: id, updated_at: '2026-10-01T00:00:00Z', deleted_at: null,
})
const now = () => new Date('2026-10-13T10:00:00Z')
let db: VaultDB
afterEach(async () => { db?.close(); if (db) await db.delete() })

const ready = (r: { current: ReturnType<typeof useHomeData> }) => {
  if (r.current.status !== 'ready') throw new Error(r.current.status)
  return r.current.stats
}

describe('useHomeData', () => {
  it('recalcule les compteurs quand le cache change (synchro qui ramène des cartes, note ajoutée)', async () => {
    db = new VaultDB(`home-${crypto.randomUUID()}`)
    await db.cards.bulkPut([card('a', ['ia']), card('b', ['ia', 'dev'])])
    const { result } = renderHook(() => useHomeData(db, now))
    await waitFor(() => expect(ready(result).today).toBe(2))
    expect(ready(result).tags.find(t => t.slug === 'dev')!.count).toBe(1)

    await act(async () => { await db.cards.put(card('c', ['culture'])) }) // comme un sync
    await waitFor(() => expect(ready(result).total).toBe(3))
    expect(ready(result).tags.find(t => t.slug === 'culture')!.count).toBe(1)

    await act(async () => { await db.reviews.add({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T09:00:00Z', synced: 0 }) })
    await waitFor(() => expect(ready(result).fresh).toBe(2)) // 'a' vue aujourd'hui : plus nouvelle
  })
})
