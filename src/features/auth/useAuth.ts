import { useCallback, useEffect, useState } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in'

export const BAD_CREDENTIALS = 'E-mail ou mot de passe incorrect.'
export const OFFLINE = 'Pas de connexion. Réessaie quand tu as du réseau.'

export function useAuth(): {
  status: AuthStatus
  signIn(email: string, password: string): Promise<{ error: string | null }>
  signOut(): Promise<void>
} {
  const [status, setStatus] = useState<AuthStatus>('loading')

  useEffect(() => {
    let active = true

    // On ne regarde jamais l'expiration : hors ligne, un jeton expiré ne doit pas déconnecter.
    // supabase-js, s'il ne peut pas rafraîchir le jeton faute de réseau, garde la session en
    // stockage mais renvoie `session: null` + une erreur réseau : on reste connecté dans ce cas aussi.
    supabase.auth.getSession().then(
      ({ data, error }) => {
        if (!active) return
        setStatus(data.session || isAuthRetryableFetchError(error) ? 'signed-in' : 'signed-out')
      },
      () => { if (active) setStatus('signed-out') },
    )

    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setStatus('signed-in')
      else if (event === 'SIGNED_OUT') setStatus('signed-out')
    })

    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) return { error: isAuthRetryableFetchError(error) ? OFFLINE : BAD_CREDENTIALS }
      setStatus('signed-in')
      return { error: null }
    } catch {
      return { error: OFFLINE }
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      setStatus('signed-out')
    }
  }, [])

  return { status, signIn, signOut }
}
