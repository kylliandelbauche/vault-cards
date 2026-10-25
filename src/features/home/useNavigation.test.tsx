import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

  it('Profil (#83) se pose sur la révision sans la remplacer : pile, profondeur d’historique, retours', async () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due', tag: 'dev' }))
    act(() => result.current.openProfile())
    expect(result.current.screen).toEqual({ name: 'profile' })
    expect(result.current.previous).toEqual({ name: 'review', scope: { mode: 'due', tag: 'dev' } })
    expect(result.current.stack.map(s => s.name)).toEqual(['home', 'review', 'profile'])
    expect(depth()).toBe(2)
    act(() => result.current.openProfile()) // déjà affiché : rien
    expect(result.current.stack).toHaveLength(3)
    act(() => result.current.openCards()) // Profil › Cartes : la révision reste dans la pile
    act(() => result.current.openTags())
    expect(result.current.stack.map(s => s.name)).toEqual(['home', 'review', 'profile', 'cards', 'tags'])
    expect(depth()).toBe(4)
    act(() => result.current.back())
    act(() => result.current.back())
    expect(result.current.screen).toEqual({ name: 'profile' })
    act(() => result.current.back())
    expect(result.current.screen).toMatchObject({ name: 'review', scope: { mode: 'due', tag: 'dev' } })
    await waitFor(() => expect(depth()).toBe(1))
  })

  it('une nouvelle révision remplace la précédente, mais pas quand un autre écran se pose sur elle', () => {
    const { result } = renderHook(() => useNavigation())
    act(() => result.current.openReview({ mode: 'due', tag: 'ia' }))
    act(() => result.current.openReview({ mode: 'due', tag: 'dev' }))
    expect(result.current.stack.map(s => s.name)).toEqual(['home', 'review'])
    expect(result.current.screen).toMatchObject({ scope: { tag: 'dev' } })
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

describe('useNavigation : garde de sortie (#88)', () => {
  const setup = () => {
    const guard = vi.fn()
    const hook = renderHook(() => useNavigation())
    act(() => hook.result.current.open({ name: 'new-card' }))
    expect(depth()).toBe(1)
    return { guard, ...hook }
  }

  it('sans garde : le retour de l’utilisateur ferme l’écran tout de suite (comportement inchangé)', async () => {
    const { result } = setup()
    act(() => { window.history.back() })
    await waitFor(() => expect(result.current.screen).toEqual({ name: 'home' }))
    expect(depth()).toBe(0)
  })

  it('avec garde : l’écran reste, l’entrée d’historique est reposée et le garde est appelé ; « Ignorer » dépile', async () => {
    const { result, guard } = setup()
    act(() => { result.current.registerGuard(guard) })
    act(() => { window.history.back() })
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1))
    await settle()
    expect(result.current.screen).toEqual({ name: 'new-card' })
    expect(depth()).toBe(1)
    // « Ignorer » = back() de l'app : l'écran se ferme, l'historique est dépilé, le garde n'est pas rappelé.
    act(() => result.current.back())
    await waitFor(() => expect(depth()).toBe(0))
    expect(result.current.screen).toEqual({ name: 'home' })
    expect(guard).toHaveBeenCalledTimes(1)
  })

  it('« Continuer » : l’écran reste et un nouveau retour redemande', async () => {
    const { result, guard } = setup()
    act(() => { result.current.registerGuard(guard) })
    act(() => { window.history.back() })
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1))
    await settle()
    act(() => { window.history.back() })
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(2))
    await settle()
    expect(result.current.screen).toEqual({ name: 'new-card' })
    expect(depth()).toBe(1)
  })

  it('deux retours d’affilée : un appel du garde par retour, pas de boucle, pas de dérive de la pile', async () => {
    const { result, guard } = setup()
    act(() => { result.current.registerGuard(guard) })
    act(() => { window.history.back() })
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1))
    await settle()
    act(() => { window.history.back() })
    await settle()
    expect(guard).toHaveBeenCalledTimes(2)
    expect(result.current.screen).toEqual({ name: 'new-card' })
    expect(depth()).toBe(1)
    act(() => result.current.back())
    await waitFor(() => expect(depth()).toBe(0))
    expect(result.current.screen).toEqual({ name: 'home' })
  })

  it('deux retours dans le même instant : jsdom n’en traverse qu’un, le garde est appelé exactement une fois, pile intacte', async () => {
    const { result, guard } = setup()
    act(() => { result.current.registerGuard(guard) })
    act(() => { window.history.back(); window.history.back() })
    await settle()
    expect(guard).toHaveBeenCalledTimes(1)
    expect(result.current.screen).toEqual({ name: 'new-card' })
    expect(depth()).toBe(1)
  })

  it('garde remplacé : l’ancien, en se retirant, n’efface pas le nouveau', async () => {
    const { result, guard } = setup()
    let off = () => {}
    act(() => { off = result.current.registerGuard(guard) })
    const other = vi.fn()
    act(() => { result.current.registerGuard(other) })
    act(() => off())
    act(() => { window.history.back() })
    await waitFor(() => expect(other).toHaveBeenCalledTimes(1))
    expect(guard).not.toHaveBeenCalled()
  })

  it('garde retiré (plus de modification) : le retour redevient immédiat', async () => {
    const { result, guard } = setup()
    let off = () => {}
    act(() => { off = result.current.registerGuard(guard) })
    act(() => off())
    act(() => { window.history.back() })
    await waitFor(() => expect(result.current.screen).toEqual({ name: 'home' }))
    expect(guard).not.toHaveBeenCalled()
  })

  it('le retour lancé par l’app n’est jamais intercepté, même avec un garde', async () => {
    const { result, guard } = setup()
    act(() => { result.current.registerGuard(guard) })
    act(() => result.current.back())
    await settle()
    expect(guard).not.toHaveBeenCalled()
    expect(result.current.screen).toEqual({ name: 'home' })
    expect(depth()).toBe(0)
  })

  it('retour de plusieurs niveaux d’un coup avec garde : tous les niveaux sont reposés', async () => {
    const { result, guard } = setup()
    act(() => result.current.open({ name: 'source-text' }))
    expect(depth()).toBe(2)
    act(() => { result.current.registerGuard(guard) })
    act(() => { window.history.go(-2) })
    await waitFor(() => expect(guard).toHaveBeenCalledTimes(1))
    await settle()
    expect(result.current.screen).toEqual({ name: 'source-text' })
    expect(depth()).toBe(2)
  })
})
