import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { VaultDB } from '../../lib/db'
import type { Card } from '../../lib/types'
import { msUntilNextLocalDay, useHomeData } from './useHomeData'

const card = (id: string, tags: string[]): Card => ({
  id, deck: 'x', tags, source_path: `x/${id}.md`, front: id, back: id, updated_at: '2026-10-01T00:00:00Z', deleted_at: null,
})
const now = () => new Date('2026-10-13T10:00:00Z')
let db: VaultDB
afterEach(async () => { vi.useRealTimers(); db?.close(); if (db) await db.delete() })

const ready = (r: { current: ReturnType<typeof useHomeData> }) => {
  if (r.current.status !== 'ready') throw new Error(r.current.status)
  return r.current.stats
}

describe('useHomeData', () => {
  it('recalcule les compteurs quand le cache change (synchro qui ramène des cartes, note ajoutée)', async () => {
    db = new VaultDB(`home-${crypto.randomUUID()}`)
    await db.cards.bulkPut([card('a', ['ia']), card('b', ['ia', 'dev'])])
    const { result } = renderHook(() => useHomeData(db, now, true))
    await waitFor(() => expect(ready(result).today).toBe(2))
    expect(ready(result).tags.find(t => t.slug === 'dev')!.total).toBe(1)

    await act(async () => { await db.cards.put(card('c', ['culture'])) }) // comme un sync
    await waitFor(() => expect(ready(result).total).toBe(3))
    expect(ready(result).tags.find(t => t.slug === 'culture')!.total).toBe(1)

    await act(async () => { await db.reviews.add({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T09:00:00Z', synced: 0 }) })
    await waitFor(() => expect(ready(result).fresh).toBe(2)) // 'a' vue aujourd'hui : plus nouvelle
  })

  it('inactif (révision affichée) puis actif : les derniers compteurs restent affichés pendant le recalcul', async () => {
    db = new VaultDB(`home-${crypto.randomUUID()}`)
    await db.cards.bulkPut([card('a', ['ia'])])
    const { result, rerender } = renderHook(({ active }) => useHomeData(db, now, active), { initialProps: { active: true } })
    await waitFor(() => expect(ready(result).today).toBe(1))
    rerender({ active: false })
    await act(async () => { await db.cards.put(card('b', ['ia'])) })
    expect(ready(result).today).toBe(1) // pas d'abonnement pendant la révision
    rerender({ active: true })
    expect(result.current.status).toBe('ready') // pas de retour à « loading » (pas de spinner)
    await waitFor(() => expect(ready(result).today).toBe(2))
  })

  it('passage de minuit app ouverte : compteurs recalculés au changement de jour local', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
    let clock = new Date(2026, 9, 12, 23, 59, 0)
    db = new VaultDB(`home-${crypto.randomUUID()}`)
    await db.cards.bulkPut(Array.from({ length: 30 }, (_, i) => card(`n${String(i).padStart(2, '0')}`, ['ia'])))
    await db.reviews.add({ id: 'r', card_id: 'n00', rating: 3, reviewed_at: new Date(2026, 9, 12, 23, 0).toISOString(), synced: 1 })
    const { result } = renderHook(() => useHomeData(db, () => clock, true))
    await waitFor(() => expect(ready(result).fresh).toBe(19))
    clock = new Date(2026, 9, 13, 0, 0, 2)
    act(() => { vi.advanceTimersByTime(62_000) })
    expect(ready(result).fresh).toBe(20)
  })
})

describe('msUntilNextLocalDay', () => {
  it('jusqu’à 00:00:01 le lendemain (heure locale), au moins 1 s', () => {
    expect(msUntilNextLocalDay(new Date(2026, 9, 12, 23, 59, 0))).toBe(61_000)
    expect(msUntilNextLocalDay(new Date(2026, 9, 12, 0, 0, 0))).toBe(24 * 3600_000 + 1000)
    expect(msUntilNextLocalDay(new Date(2026, 9, 13, 0, 0, 0, 500))).toBeGreaterThanOrEqual(1000)
  })
})
