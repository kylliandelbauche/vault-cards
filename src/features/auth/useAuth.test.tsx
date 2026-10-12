import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

// Le vrai client n'est jamais chargé : pas de variables d'environnement ni de réseau dans les tests.
const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../../lib/supabase', () => ({ supabase: { auth } }))

import { useAuth } from './useAuth'

const nowSec = () => Math.floor(Date.now() / 1000)
const session = (expiresAt: number) => ({ access_token: 'a', refresh_token: 'r', expires_at: expiresAt }) as Session

let emit: (event: AuthChangeEvent, s: Session | null) => void
const unsubscribe = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  auth.onAuthStateChange.mockImplementation((cb: typeof emit) => {
    emit = cb
    return { data: { subscription: { unsubscribe } } }
  })
  auth.signOut.mockResolvedValue({ error: null })
})

describe('useAuth', () => {
  it('session présente → signed-in', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session(nowSec() + 3600) }, error: null })
    const { result } = renderHook(() => useAuth())
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
  })

  it('aucune session → signed-out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
  })

  it('hors ligne avec jeton expiré → signed-in quand même', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session(nowSec() - 3600) }, error: null })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
  })

  it('hors ligne, rafraîchissement du jeton en échec réseau → signed-in quand même', async () => {
    // Forme réelle de supabase-js hors ligne : session gardée en stockage, mais getSession renvoie null + erreur réseau.
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
  })

  it('identifiants refusés → message unique', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    let res: { error: string | null } | undefined
    await act(async () => { res = await result.current.signIn('a@b.c', 'faux') })
    expect(res).toEqual({ error: 'E-mail ou mot de passe incorrect.' })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'faux' })
    expect(result.current.status).toBe('signed-out')
  })

  it('erreur réseau à la connexion → message « Pas de connexion »', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    let res: { error: string | null } | undefined
    await act(async () => { res = await result.current.signIn('a@b.c', 'x') })
    expect(res).toEqual({ error: 'Pas de connexion. Réessaie quand tu as du réseau.' })
  })

  it('connexion réussie → signed-in, sans erreur', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    auth.signInWithPassword.mockResolvedValue({ data: { session: session(nowSec() + 3600), user: {} }, error: null })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    let res: { error: string | null } | undefined
    await act(async () => { res = await result.current.signIn('a@b.c', 'bon') })
    expect(res).toEqual({ error: null })
    expect(result.current.status).toBe('signed-in')
  })

  it('événement SIGNED_OUT → signed-out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session(nowSec() + 3600) }, error: null })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    act(() => emit('SIGNED_OUT', null))
    expect(result.current.status).toBe('signed-out')
  })

  it('INITIAL_SESSION sans session ne déconnecte pas', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    act(() => emit('INITIAL_SESSION', null))
    expect(result.current.status).toBe('signed-in')
  })

  it('signOut appelle Supabase et passe signed-out ; désabonnement au démontage', async () => {
    auth.getSession.mockResolvedValue({ data: { session: session(nowSec() + 3600) }, error: null })
    const { result, unmount } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    await act(async () => { await result.current.signOut() })
    expect(auth.signOut).toHaveBeenCalled()
    expect(result.current.status).toBe('signed-out')
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
