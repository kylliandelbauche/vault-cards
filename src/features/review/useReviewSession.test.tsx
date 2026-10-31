import { describe, it, expect } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useReviewSession, memoryStore, SCREEN_CHANGE_GUARD_MS, type ReviewStore, type SessionScope } from './useReviewSession'
import type { Card, Review } from '../../lib/types'

const cards: Card[] = ['a', 'b'].map(id => ({ id, source: 'vault', deck: 'x', tags: [], source_path: `x/${id}.md`, front: id, back: id,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null }))
// Horloge qui avance d'une seconde à chaque lecture : chaque action tombe après la garde anti double tap.
const START = Date.parse('2026-10-12T10:00:00Z')
let tick = 0
const fixedNow = () => new Date(START + 1000 * tick++)

describe('useReviewSession', () => {
  it('révéler puis noter passe à la carte suivante', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    const first = result.current.current!.card.id
    act(() => result.current.reveal())
    await act(async () => result.current.rate(3))
    expect(result.current.current!.card.id).not.toBe(first)
    expect(result.current.revealed).toBe(false)
  })
  describe('menu ⋯ (#73)', () => {
    it('modifier : même carte, même face, texte mis à jour, aucune note', async () => {
      const store = memoryStore(cards)
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      const id = result.current.current!.card.id
      act(() => result.current.reveal())
      await act(async () => result.current.edit({ front: 'Nouvelle question', back: 'Nouvelle réponse', tags: ['Mémoire'] }))
      expect(result.current.current!.card).toMatchObject({ id, front: 'Nouvelle question', back: 'Nouvelle réponse', tags: ['Mémoire'] })
      expect(result.current.revealed).toBe(true)
      expect(result.current.position).toEqual({ n: 1, total: 2 })
      expect(await store.loadReviews()).toHaveLength(0)
      expect((await store.loadCards()).find(c => c.id === id)!.front).toBe('Nouvelle question')
    })

    it('modifier en échec : rejette, la carte affichée ne change pas', async () => {
      const store: ReviewStore = { ...memoryStore(cards), updateCard: async () => { throw new Error('IndexedDB indisponible') } }
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      const before = result.current.current!.card
      await act(async () => { await expect(result.current.edit({ front: 'X', back: 'Y', tags: [] })).rejects.toThrow() })
      expect(result.current.current!.card).toEqual(before)
    })

    it('supprimer : carte suivante, aucune note comptée, « sur N » réduit, plus proposée', async () => {
      const store = memoryStore(cards)
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      const first = result.current.current!.card.id
      act(() => result.current.reveal())
      await act(async () => result.current.remove())
      expect(result.current.current!.card.id).not.toBe(first)
      expect(result.current.revealed).toBe(false)
      expect(result.current.position).toEqual({ n: 1, total: 1 })
      expect(result.current.progress).toBe(0)
      expect(result.current.stats).toEqual({ again: 0, hard: 0, good: 0 })
      expect(await store.loadReviews()).toHaveLength(0)
      expect((await store.loadCards()).find(c => c.id === first)!.deleted_at).not.toBeNull()
    })

    it('supprimer une carte déjà ratée : « sur N » inchangé ; dernière carte → fin de session', async () => {
      const store = memoryStore(cards)
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      act(() => result.current.reveal()); await act(async () => result.current.rate(1)) // ratée : revient à la fin
      act(() => result.current.reveal()); await act(async () => result.current.rate(3))
      expect(result.current.position).toEqual({ n: 2, total: 2 })
      await act(async () => result.current.remove())
      expect(result.current.status).toBe('done')
      expect(result.current.stats).toEqual({ again: 1, hard: 0, good: 1 })
    })

    it('supprimer pendant l’écriture d’une note : attend la note, puis supprime la carte affichée (pas la suivante)', async () => {
      const base = memoryStore(cards)
      let finish!: () => void
      const store: ReviewStore = { ...base, addReview: r => new Promise<void>(resolve => { finish = () => { void base.addReview(r).then(resolve) } }) }
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      const first = result.current.current!.card.id
      act(() => result.current.reveal())
      let removed!: Promise<void>
      await act(async () => { result.current.rate(3); removed = result.current.remove() })
      expect((await base.loadCards()).every(c => c.deleted_at === null)).toBe(true) // rien de supprimé tant que la note s'écrit
      await act(async () => { finish(); await removed })
      expect(await base.loadReviews()).toHaveLength(1)
      expect((await base.loadCards()).filter(c => c.deleted_at !== null).map(c => c.id)).toEqual([first])
      expect(result.current.current!.card.id).not.toBe(first)
      expect(result.current.position).toEqual({ n: 2, total: 2 })
    })

    it('supprimer la seule carte : écran vide ; échec d’écriture : rejette, rien ne change', async () => {
      const failing: ReviewStore = { ...memoryStore(cards), deleteCard: async () => { throw new Error('IndexedDB indisponible') } }
      const a = renderHook(() => useReviewSession(failing, fixedNow))
      await waitFor(() => expect(a.result.current.status).toBe('reviewing'))
      const before = a.result.current.current!.card.id
      await act(async () => { await expect(a.result.current.remove()).rejects.toThrow() })
      expect(a.result.current.current!.card.id).toBe(before)
      expect(a.result.current.position).toEqual({ n: 1, total: 2 })

      const b = renderHook(() => useReviewSession(memoryStore([cards[0]]), fixedNow))
      await waitFor(() => expect(b.result.current.status).toBe('reviewing'))
      await act(async () => b.result.current.remove())
      expect(b.result.current.status).toBe('empty')
    })
  })
  it('noter sans avoir révélé ne fait rien', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    await act(async () => result.current.rate(3))
    expect((await store.loadReviews())).toHaveLength(0)
  })
  it('double tap : une seule review', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reveal())
    await act(async () => { result.current.rate(3); result.current.rate(3) })
    expect((await store.loadReviews())).toHaveLength(1)
  })
  it('« Je ne sais pas » remet la carte en fin de session', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    const first = result.current.current!.card.id
    act(() => result.current.reveal()); await act(async () => result.current.rate(1))
    act(() => result.current.reveal()); await act(async () => result.current.rate(3))
    expect(result.current.current!.card.id).toBe(first)
  })
  it('« Carte n sur N » (#82) : N = file au démarrage ; une carte ratée revient en fin de file sans dépasser N', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    expect(result.current.position).toEqual({ n: 1, total: 2 })
    act(() => result.current.reveal()); await act(async () => result.current.rate(1)) // ratée : revient à la fin
    expect(result.current.position).toEqual({ n: 2, total: 2 })
    act(() => result.current.reveal()); await act(async () => result.current.rate(3))
    expect(result.current.status).toBe('reviewing') // la carte ratée
    expect(result.current.position).toEqual({ n: 2, total: 2 })
    act(() => result.current.reveal()); await act(async () => result.current.rate(1)) // ratée encore
    expect(result.current.position).toEqual({ n: 2, total: 2 })
  })
  it('fin de session : status done + stats', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    for (let i = 0; i < cards.length; i++) { act(() => result.current.reveal()); await act(async () => result.current.rate(3)) }
    expect(result.current.status).toBe('done')
    expect(result.current.stats).toEqual({ again: 0, hard: 0, good: 2 })
  })
  it('aucune carte : status empty', async () => {
    const { result } = renderHook(() => useReviewSession(memoryStore([]), fixedNow))
    await waitFor(() => expect(result.current.status).toBe('empty'))
  })
  it('seulement des brouillons de la boîte de réception (#55) : status empty, pas « terminé »', async () => {
    const drafts: Card[] = cards.map(c => ({ ...c, source: 'inbox', status: 'draft', inbox_id: 'i1', deck: null, source_path: null }))
    const { result } = renderHook(() => useReviewSession(memoryStore(drafts), fixedNow))
    await waitFor(() => expect(result.current.status).toBe('empty'))
  })

  it('un store recréé à chaque rendu ne relance pas le chargement', async () => {
    let loads = 0
    const make = () => ({ ...memoryStore(cards), loadCards: async () => { loads++; return cards } })
    const { result } = renderHook(() => useReviewSession(make(), fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reveal())
    expect(loads).toBe(1)
  })

  it('« Réviser à nouveau » (révision libre) : propose toutes les cartes même si aucune n’est due', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    for (let i = 0; i < cards.length; i++) { act(() => result.current.reveal()); await act(async () => result.current.rate(3)) }
    expect(result.current.status).toBe('done')

    act(() => result.current.restart()) // session normale : rien n'est dû
    await waitFor(() => expect(result.current.status).toBe('done'))

    act(() => result.current.reviewAll())
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    expect(result.current.counts.due + result.current.counts.learn + result.current.counts.new).toBe(cards.length)
    expect(result.current.stats).toEqual({ again: 0, hard: 0, good: 0 })
    act(() => result.current.reveal())
    await act(async () => result.current.rate(3))
    expect(await store.loadReviews()).toHaveLength(cards.length + 1) // notée normalement
  })

  it('révision libre : les notes sont marquées free (hors quota du jour) ; session normale : non (#22)', async () => {
    const store = memoryStore(cards)
    const { result, rerender } = renderHook(({ scope }) => useReviewSession(store, fixedNow, scope), { initialProps: { scope: { mode: 'all' } as SessionScope } })
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reveal())
    await act(async () => result.current.rate(3))
    expect((await store.loadReviews()).map(r => r.free)).toEqual([true])

    rerender({ scope: { mode: 'due' } })
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reveal())
    await act(async () => result.current.rate(3))
    expect((await store.loadReviews()).map(r => r.free)).toEqual([true, undefined])
  })

  it('« Réviser à nouveau » depuis une session normale : notes marquées free', async () => {
    const store = memoryStore(cards)
    const { result } = renderHook(() => useReviewSession(store, fixedNow))
    await waitFor(() => expect(result.current.status).toBe('reviewing'))
    act(() => result.current.reviewAll())
    await waitFor(() => expect(result.current.counts.new).toBe(cards.length))
    act(() => result.current.reveal())
    await act(async () => result.current.rate(3))
    expect((await store.loadReviews()).map(r => r.free)).toEqual([true])
  })

  describe('erreurs du stockage local', () => {
    it('chargement en échec : status error, puis restart() recharge', async () => {
      let fail = true
      const base = memoryStore(cards)
      const store = { ...base, loadCards: async () => { if (fail) throw new Error('IndexedDB indisponible'); return base.loadCards() } }
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('error'))
      fail = false
      act(() => result.current.restart())
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
    })
    it('restart() en échec : status error (pas de rejet non géré)', async () => {
      let fail = false
      const base = memoryStore(cards)
      const store = { ...base, loadReviews: async () => { if (fail) throw new Error('IndexedDB indisponible'); return base.loadReviews() } }
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      fail = true
      act(() => result.current.restart())
      await waitFor(() => expect(result.current.status).toBe('error'))
    })
    it('écriture d’une note en échec : on reste sur la carte, erreur visible, la note peut être refaite', async () => {
      let fail = true
      const base = memoryStore(cards)
      const store = { ...base, addReview: async (r: Review) => { if (fail) throw new Error('quota dépassé'); return base.addReview(r) } }
      const { result } = renderHook(() => useReviewSession(store, fixedNow))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      const first = result.current.current!.card.id
      act(() => result.current.reveal())
      await act(async () => result.current.rate(3))
      expect(result.current.current!.card.id).toBe(first)
      expect(result.current.revealed).toBe(true)
      expect(result.current.saveFailed).toBe(true)
      expect(result.current.progress).toBe(0)
      fail = false
      await act(async () => result.current.rate(3))
      expect(result.current.current!.card.id).not.toBe(first)
      expect(result.current.saveFailed).toBe(false)
      expect(await store.loadReviews()).toHaveLength(1)
    })
  })

  describe('garde anti double tap entre révéler et noter', () => {
    // Horloge pilotée à la main pour placer chaque tap à la milliseconde près.
    let t = START
    const clock = () => new Date(t)
    const setup = async () => {
      t = START
      const store = memoryStore(cards)
      const hook = renderHook(() => useReviewSession(store, clock))
      await waitFor(() => expect(hook.result.current.status).toBe('reviewing'))
      return { store, result: hook.result }
    }

    it('ouverture de session : une révélation juste après le chargement est ignorée (2e tap d’un double tap)', async () => {
      const { result } = await setup()
      t += SCREEN_CHANGE_GUARD_MS - 1
      act(() => result.current.reveal())
      expect(result.current.revealed).toBe(false)
      t += 1
      act(() => result.current.reveal())
      expect(result.current.revealed).toBe(true)
    })
    it('une note juste après la révélation est ignorée (aucune review)', async () => {
      const { store, result } = await setup()
      t += 1000
      act(() => result.current.reveal())
      t += SCREEN_CHANGE_GUARD_MS - 1
      await act(async () => result.current.rate(2))
      expect(await store.loadReviews()).toHaveLength(0)
      expect(result.current.revealed).toBe(true)
    })
    it('une note après le délai est enregistrée', async () => {
      const { store, result } = await setup()
      t += 1000
      act(() => result.current.reveal())
      t += SCREEN_CHANGE_GUARD_MS
      await act(async () => result.current.rate(2))
      expect(await store.loadReviews()).toHaveLength(1)
    })
    it('une révélation juste après une note est ignorée', async () => {
      const { result } = await setup()
      t += 1000
      act(() => result.current.reveal())
      t += 1000
      await act(async () => result.current.rate(3))
      const next = result.current.current!.card.id
      t += SCREEN_CHANGE_GUARD_MS - 1
      act(() => result.current.reveal())
      expect(result.current.revealed).toBe(false)
      t += 1
      act(() => result.current.reveal())
      expect(result.current.revealed).toBe(true)
      expect(result.current.current!.card.id).toBe(next)
    })
  })

  describe('portée de la session (#53)', () => {
    const tagged: Card[] = [
      { ...cards[0], id: 'ia1', tags: ['ia'] },
      { ...cards[0], id: 'dev1', tags: ['dev'] },
      { ...cards[0], id: 'both', tags: ['ia', 'dev'] },
    ]
    const ids = (r: { current: ReturnType<typeof useReviewSession> }) => r.current.counts.new
    type Props = { scope: SessionScope | null }

    it('scope null : idle, rien n’est lu', async () => {
      let loads = 0
      const store: ReviewStore = { ...memoryStore(cards), loadCards: async () => { loads++; return cards } }
      const { result } = renderHook(() => useReviewSession(store, fixedNow, null))
      await act(async () => {})
      expect(result.current.status).toBe('idle')
      expect(result.current.current).toBeNull()
      expect(loads).toBe(0)
    })

    it('session limitée à un tag : seulement ses cartes ; restart() et reviewAll() gardent le tag', async () => {
      const store = memoryStore(tagged)
      const scope: SessionScope = { mode: 'due', tag: 'ia' }
      const { result } = renderHook(() => useReviewSession(store, fixedNow, scope))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      expect(ids(result)).toBe(2)
      const seen: string[] = []
      for (let i = 0; i < 2; i++) {
        seen.push(result.current.current!.card.id)
        act(() => result.current.reveal()); await act(async () => result.current.rate(3))
      }
      expect(seen.sort()).toEqual(['both', 'ia1'])
      expect(result.current.status).toBe('done')
      act(() => result.current.reviewAll())
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      expect(result.current.counts.learn + result.current.counts.due + result.current.counts.new).toBe(2)
    })

    it('fin d’une session par tag : la prochaine échéance ne regarde que les cartes du tag', async () => {
      // Carte « dev » vue juste avant (« Je ne sais pas ») : due dans ~1 min, plus tôt que la carte IA notée.
      const t0 = fixedNow().getTime()
      const devReview: Review = { id: 'r-dev', card_id: 'dev1', rating: 1, reviewed_at: new Date(t0).toISOString(), synced: 1 }
      const base = memoryStore([tagged[0], tagged[1]])
      const store: ReviewStore = { ...base, loadReviews: async () => [devReview, ...(await base.loadReviews())] }
      const scope: SessionScope = { mode: 'due', tag: 'ia' }
      const { result } = renderHook(() => useReviewSession(store, fixedNow, scope))
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      expect(result.current.current!.card.id).toBe('ia1')
      act(() => result.current.reveal()); await act(async () => result.current.rate(3))
      expect(result.current.status).toBe('done')
      // « Très bien » sur une nouvelle carte : prochaine étape d'apprentissage à 10 min, pas la carte dev à ~1 min.
      expect(result.current.nextDueAt!.getTime() - t0).toBeGreaterThan(5 * 60_000)
    })

    describe('liste de cartes (#105, « Étudier ces N cartes »)', () => {
      const pool: Card[] = [...tagged, { ...cards[0], id: 'draft1', source: 'inbox', status: 'draft' }, { ...cards[0], id: 'other' }]
      const rateOne = async (r: { current: ReturnType<typeof useReviewSession> }) => {
        act(() => r.current.reveal()); await act(async () => r.current.rate(3))
      }

      it('révision libre limitée aux cartes données : « sur N », notes marquées free, jamais les autres ni un brouillon', async () => {
        const store = memoryStore(pool)
        const scope: SessionScope = { mode: 'all', cardIds: ['ia1', 'both', 'draft1'] }
        const { result } = renderHook(() => useReviewSession(store, fixedNow, scope))
        await waitFor(() => expect(result.current.status).toBe('reviewing'))
        expect(result.current.position).toEqual({ n: 1, total: 2 })
        const seen: string[] = []
        for (let i = 0; i < 2; i++) { seen.push(result.current.current!.card.id); await rateOne(result) }
        expect(seen.sort()).toEqual(['both', 'ia1'])
        expect(result.current.status).toBe('done')
        expect((await store.loadReviews()).map(r => r.free)).toEqual([true, true])
      })

      it('plus de 20 nouvelles : toutes proposées (le quota du jour ne s’applique pas)', async () => {
        const many = Array.from({ length: 25 }, (_, i) => ({ ...cards[0], id: `n${i}` }))
        const store = memoryStore([...many, ...pool])
        const scope: SessionScope = { mode: 'all', cardIds: many.map(c => c.id) }
        const { result } = renderHook(() => useReviewSession(store, fixedNow, scope))
        await waitFor(() => expect(result.current.status).toBe('reviewing'))
        expect(result.current.position.total).toBe(25)
      })

      it('« Réviser à nouveau » et « Réessayer » restent dans la liste, en révision libre', async () => {
        const store = memoryStore(pool)
        const scope: SessionScope = { mode: 'all', cardIds: ['ia1', 'dev1'] }
        const { result } = renderHook(() => useReviewSession(store, fixedNow, scope))
        await waitFor(() => expect(result.current.status).toBe('reviewing'))
        await rateOne(result); await rateOne(result)
        expect(result.current.status).toBe('done')
        act(() => result.current.reviewAll())
        await waitFor(() => expect(result.current.status).toBe('reviewing'))
        expect(result.current.position.total).toBe(2)
        await rateOne(result); await rateOne(result)
        act(() => result.current.restart())
        await waitFor(() => expect(result.current.status).toBe('reviewing'))
        expect(result.current.position.total).toBe(2) // pas dues + nouvelles du jour de tout le paquet
        await rateOne(result)
        expect((await store.loadReviews()).every(r => r.free === true)).toBe(true)
      })

      it('fin de session : la prochaine échéance ne regarde que les cartes de la liste', async () => {
        // « other » vue juste avant (« Je ne sais pas ») : due dans ~1 min, hors liste.
        const t0 = fixedNow().getTime()
        const otherReview: Review = { id: 'r-other', card_id: 'other', rating: 1, reviewed_at: new Date(t0).toISOString(), synced: 1 }
        const base = memoryStore(pool)
        const store: ReviewStore = { ...base, loadReviews: async () => [otherReview, ...(await base.loadReviews())] }
        const scope: SessionScope = { mode: 'all', cardIds: ['ia1'] }
        const { result } = renderHook(() => useReviewSession(store, fixedNow, scope))
        await waitFor(() => expect(result.current.status).toBe('reviewing'))
        await rateOne(result)
        expect(result.current.status).toBe('done')
        expect(result.current.nextDueAt!.getTime() - t0).toBeGreaterThan(5 * 60_000)
      })

      it('liste dont plus aucune carte n’est vivante : « done », pas la fausse alerte d’un paquet vide', async () => {
        const store = memoryStore(pool)
        const scope: SessionScope = { mode: 'all', cardIds: ['draft1', 'inconnue'] }
        const { result } = renderHook(() => useReviewSession(store, fixedNow, scope))
        await waitFor(() => expect(result.current.status).toBe('done'))
        expect(result.current.nextDueAt).toBeNull()
      })
    })

    it('changer de scope relance une session (loading, puis la nouvelle file) ; null → idle', async () => {
      const store = memoryStore(tagged)
      const { result, rerender } = renderHook(({ scope }: Props) => useReviewSession(store, fixedNow, scope), { initialProps: { scope: { mode: 'due', tag: 'dev' } as SessionScope | null } })
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      act(() => result.current.reveal())
      rerender({ scope: null })
      expect(result.current.status).toBe('idle')
      rerender({ scope: { mode: 'due' } })
      expect(result.current.status).toBe('loading')
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      expect(result.current.revealed).toBe(false)
      expect(ids(result)).toBe(3)
    })

    it('un nouvel objet scope identique relance la session (re-entrer dans « Commencer à étudier »)', async () => {
      let loads = 0
      const store: ReviewStore = { ...memoryStore(tagged), loadCards: async () => { loads++; return tagged } }
      const { result, rerender } = renderHook(({ scope }: Props) => useReviewSession(store, fixedNow, scope), { initialProps: { scope: { mode: 'due' } as SessionScope | null } })
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      rerender({ scope: { mode: 'due' } })
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      expect(loads).toBe(2)
    })

    it('un chargement lent d’une session quittée ne s’applique pas sur la suivante', async () => {
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      let calls = 0
      const store: ReviewStore = {
        ...memoryStore(tagged),
        // 1er chargement (session A, toutes les cartes) lent ; 2e (session B) immédiat.
        loadCards: async () => { if (calls++ === 0) await gate; return tagged },
      }
      const { result, rerender } = renderHook(({ scope }: Props) => useReviewSession(store, fixedNow, scope), { initialProps: { scope: { mode: 'due' } as SessionScope | null } })
      rerender({ scope: { mode: 'due', tag: 'ia' } })
      await waitFor(() => expect(result.current.status).toBe('reviewing'))
      expect(ids(result)).toBe(2)
      await act(async () => { release(); await gate })
      expect(ids(result)).toBe(2)
    })
  })
})
