import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNavigation } from './useNavigation'

beforeEach(() => { window.history.replaceState(null, '') })

describe('useNavigation', () => {
  it('accueil au départ ; openReview pousse une entrée d’historique et crée un nouvel objet scope à chaque appel', () => {
    const { result } = renderHook(() => useNavigation())
    expect(result.current.screen).toEqual({ name: 'home' })
    const before = window.history.length
    act(() => result.current.openReview({ mode: 'due', tag: 'ia' }))
    expect(result.current.screen).toEqual({ name: 'review', scope: { mode: 'due', tag: 'ia' } })
    expect(window.history.length).toBe(before + 1)
    const first = result.current.screen
    act(() => result.current.goHome())
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
