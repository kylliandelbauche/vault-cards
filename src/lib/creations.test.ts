import { describe, it, expect } from 'vitest'
import { computeCreations } from './creations'
import type { Card } from './types'

// Dates locales (le mois est celui de l'appareil) : le test ne dépend pas du fuseau de la machine.
const now = new Date(2026, 9, 19, 12, 0)
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

let n = 0
const card = (over: Partial<Card> = {}): Card => ({
  id: `c${++n}`, source: 'manual', deck: null, source_path: null, tags: ['IA & agents'], front: 'Q ?', back: 'R.',
  created_at: at(2026, 10, 5), updated_at: at(2026, 10, 5), deleted_at: null, ...over,
})
const inbox = (inboxId: string, title: string | null, over: Partial<Card> = {}) =>
  card({ source: 'inbox', inbox_id: inboxId, source_title: title, ...over })

describe('computeCreations : compteurs (#86)', () => {
  it('sans carte : zéros, pas de génération', () => {
    expect(computeCreations([], now)).toEqual({ total: 0, thisMonth: 0, last: null })
  })

  it('compte les cartes manual et inbox actives ; exclut vault, brouillons et supprimées', () => {
    const cards = [
      card(), card(), inbox('i1', 'Cours.pdf'),
      card({ source: 'vault' }),
      inbox('i1', 'Cours.pdf', { status: 'draft' }),
      card({ deleted_at: at(2026, 10, 6) }),
      inbox('i1', 'Cours.pdf', { status: 'active' }),
    ]
    expect(computeCreations(cards, now).total).toBe(4)
  })

  it('« ce mois-ci » : mois civil local de la date du jour, pas les 30 derniers jours', () => {
    const cards = [
      card({ created_at: at(2026, 10, 1, 0, 30) }),
      card({ created_at: at(2026, 10, 18) }),
      card({ created_at: at(2026, 9, 30, 23, 30) }),
      card({ created_at: at(2025, 10, 10) }), // même mois, autre année
      card({ created_at: at(2026, 10, 10), status: 'draft', source: 'inbox', inbox_id: 'i1' }),
    ]
    const { total, thisMonth } = computeCreations(cards, now)
    expect(total).toBe(4)
    expect(thisMonth).toBe(2)
  })

  it('une carte sans created_at (vieux cache) se replie sur updated_at', () => {
    const old = card({ created_at: undefined, updated_at: at(2026, 10, 3) })
    expect(computeCreations([old], now).thisMonth).toBe(1)
  })
})

describe('computeCreations : dernière génération (#86)', () => {
  it('le document de la boîte de réception dont la carte est la plus récente, avec nom et nombre de cartes', () => {
    const cards = [
      inbox('i1', 'Vieux.pdf', { created_at: at(2026, 10, 1) }),
      inbox('i2', 'Cours FSRS.pdf', { created_at: at(2026, 10, 19, 9, 55) }),
      inbox('i2', 'Cours FSRS.pdf', { created_at: at(2026, 10, 19, 9, 56), status: 'draft' }),
      inbox('i2', 'Cours FSRS.pdf', { created_at: at(2026, 10, 19, 9, 57), deleted_at: at(2026, 10, 19, 11) }),
      card({ created_at: at(2026, 10, 19, 11) }), // manuelle : n'est pas une génération
    ]
    expect(computeCreations(cards, now).last).toEqual({
      inboxId: 'i2', title: 'Cours FSRS.pdf', at: at(2026, 10, 19, 9, 56), count: 2, drafts: 1,
    })
  })

  it('compte les brouillons restants ; tout accepté : 0', () => {
    const drafts = [inbox('i1', 'A.pdf', { status: 'draft' }), inbox('i1', 'A.pdf', { status: 'draft' }), inbox('i1', 'A.pdf')]
    expect(computeCreations(drafts, now).last).toMatchObject({ count: 3, drafts: 2 })
    expect(computeCreations([inbox('i1', 'A.pdf'), inbox('i1', 'A.pdf')], now).last).toMatchObject({ count: 2, drafts: 0 })
  })

  it('document sans titre : « Document importé »', () => {
    expect(computeCreations([inbox('i1', null)], now).last?.title).toBe('Document importé')
  })

  it('un document dont toutes les cartes sont supprimées n’est pas une génération', () => {
    const cards = [inbox('i1', 'A.pdf', { deleted_at: at(2026, 10, 6) })]
    expect(computeCreations(cards, now).last).toBeNull()
  })
})
