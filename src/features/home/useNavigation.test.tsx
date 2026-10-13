import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNavigation } from './useNavigation'

beforeEach(() => { window.history.replaceState(null, '') })
// history.back() est asynchrone : laisse arriver les popstate d'un test avant le suivant.
afterEach(() => new Promise(r => setTimeout(r, 30)))

describe('useNavigation', () => {
  it('accueil au départ ; openReview pousse une entrée d’historique et crée un nouvel objet scope à chaque appel', async () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current.screen).toEqual({ name: 'home' })
    const before = window.history.length
    act(() => result.current.openReview({ mode: 'due', tag: 'ia' }))
    expect(result.current.screen).toEqual({ name: 'review', scope: { mode: 'due', tag: 'ia' } })
    expect(window.history.length).toBe(before + 1)
    const first = result.current.screen
    act(() => result.current.goHome())
    await waitFor(() => expect(window.history.state).toBeNull())
    act(() => result.current.openReview({ mode: 'due', tag: 'ia' }))
    expect(result.current.screen).not.toBe(first)
  })

  it('goHome : accueil tout de suite, et l’entrée « révision » est dépilée', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due' }))
    act(() => result.current.goHome())
    expect(result.current.screen).toEqual({ name: 'home' })
    await waitFor(() => expect(window.history.state).toBeNull())
  })

  it('bouton « précédent » du navigateur pendant la révision : retour à l’accueil', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'all' }))
    act(() => { window.history.back() })
    await waitFor(() => expect(result.current.screen).toEqual({ name: 'home' }))
  })

  it('rechargement sur une entrée « révision » : l’app repart de l’accueil et neutralise l’entrée', () => {
    window.history.replaceState({ vaultCardsReview: true }, '')
    const { result } = renderHook(() => useNavigation())
    expect(result.current.screen).toEqual({ name: 'home' })
    expect(window.history.state).toBeNull()
  })
})

describe('useNavigation : course retour / nouvelle session', () => {
  beforeEach(() => { window.history.replaceState(null, '') })

  it('session rouverte avant le popstate du retour : on reste dans la nouvelle session, avec son entrée d’historique', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due' }))
    act(() => result.current.goHome())
    act(() => result.current.openReview({ mode: 'due', tag: 'dev' })) // avant le popstate asynchrone
    await new Promise(r => setTimeout(r, 50))
    expect(result.current.screen).toEqual({ name: 'review', scope: { mode: 'due', tag: 'dev' } })
    expect(window.history.state).toEqual({ vaultCardsReview: true })
    // Le bouton « précédent » ramène encore à l'accueil.
    act(() => { window.history.back() })
    await waitFor(() => expect(result.current.screen).toEqual({ name: 'home' }))
  })

  it('session rouverte puis quittée avant la fin du retour : accueil, aucune entrée « révision » restante', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due' }))
    act(() => result.current.goHome())
    act(() => result.current.openReview({ mode: 'all' }))
    act(() => result.current.goHome())
    await new Promise(r => setTimeout(r, 50))
    expect(result.current.screen).toEqual({ name: 'home' })
    expect(window.history.state).toBeNull()
  })
})
