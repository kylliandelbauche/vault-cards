import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useNavigation } from './useNavigation'

const depth = () => (window.history.state as { vaultCardsDepth?: number } | null)?.vaultCardsDepth ?? 0
const settle = () => act(() => new Promise(r => setTimeout(r, 50)))

beforeEach(() => { window.history.replaceState(null, '') })
// history.back() / go() sont asynchrones : laisse arriver les popstate d'un test avant le suivant.
afterEach(async () => { cleanup(); await new Promise(r => setTimeout(r, 50)) })

describe('useNavigation', () => {
  it('accueil au départ ; openReview pousse une entrée d’historique et crée un nouvel objet scope à chaque appel', async () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current.screen).toEqual({ name: 'home' })
    const before = window.history.length
    act(() => result.current.openReview({ mode: 'due', tag: 'ia' }))
    expect(result.current.screen).toEqual({ name: 'review', scope: { mode: 'due', tag: 'ia' } })
    expect(window.history.length).toBe(before + 1)
    expect(depth()).toBe(1)
    const first = result.current.screen
    act(() => result.current.back())
    await settle()
    act(() => result.current.openReview({ mode: 'due', tag: 'ia' }))
    expect(result.current.screen).not.toBe(first)
  })

  it('back : écran précédent tout de suite, et l’entrée d’historique est dépilée', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due' }))
    act(() => result.current.back())
    expect(result.current.screen).toEqual({ name: 'home' })
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('accueil → Mes tags → révision : back revient à Mes tags, puis à l’accueil ; previous désigne l’écran de retour', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openTags())
    expect(result.current.screen).toEqual({ name: 'tags' })
    expect(result.current.previous).toEqual({ name: 'home' })
    act(() => result.current.openReview({ mode: 'due', tag: 'dev' }))
    expect(depth()).toBe(2)
    expect(result.current.previous).toEqual({ name: 'tags' })
    act(() => result.current.back())
    expect(result.current.screen).toEqual({ name: 'tags' })
    await waitFor(() => expect(depth()).toBe(1))
    act(() => result.current.back())
    expect(result.current.screen).toEqual({ name: 'home' })
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('goHome depuis une révision ouverte via Mes tags : accueil, historique ramené à l’accueil', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openTags())
    act(() => result.current.openReview({ mode: 'due', tag: 'dev' }))
    act(() => result.current.goHome())
    expect(result.current.screen).toEqual({ name: 'home' })
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('bouton « précédent » du navigateur : remonte d’un écran', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openTags())
    act(() => result.current.openReview({ mode: 'all' }))
    act(() => { window.history.back() })
    await waitFor(() => expect(result.current.screen).toEqual({ name: 'tags' }))
    act(() => { window.history.back() })
    await waitFor(() => expect(result.current.screen).toEqual({ name: 'home' }))
  })

  it('rechargement sur une entrée profonde : l’app repart de l’accueil et neutralise l’entrée', () => {
    window.history.replaceState({ vaultCardsDepth: 2 }, '')
    const { result } = renderHook(() => useNavigation())
    expect(result.current.screen).toEqual({ name: 'home' })
    expect(window.history.state).toBeNull()
  })
})

describe('useNavigation : course retour / nouvelle session', () => {
  it('session rouverte avant le popstate du retour : on reste dans la nouvelle session, avec son entrée d’historique', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due' }))
    act(() => result.current.back())
    act(() => result.current.openReview({ mode: 'due', tag: 'dev' })) // avant le popstate asynchrone
    await settle()
    expect(result.current.screen).toEqual({ name: 'review', scope: { mode: 'due', tag: 'dev' } })
    expect(depth()).toBe(1)
    // Le bouton « précédent » ramène encore à l'accueil.
    act(() => { window.history.back() })
    await waitFor(() => expect(result.current.screen).toEqual({ name: 'home' }))
  })

  it('session rouverte puis quittée avant la fin du retour : accueil, aucune entrée restante', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due' }))
    act(() => result.current.back())
    act(() => result.current.openReview({ mode: 'all' }))
    act(() => result.current.back())
    await settle()
    expect(result.current.screen).toEqual({ name: 'home' })
    expect(depth()).toBe(0)
  })
})
