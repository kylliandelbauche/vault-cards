import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import type { ProfileClient } from '../../lib/account'

export interface ProfileUser {
  id: string
  email: string
  /** Pseudo choisi (métadonnées de l'utilisateur), ou chaîne vide. */
  pseudo: string
}

const toUser = (u: User | null | undefined): ProfileUser | null => {
  if (!u) return null
  const pseudo: unknown = u.user_metadata?.pseudo
  return { id: u.id, email: u.email ?? '', pseudo: typeof pseudo === 'string' ? pseudo : '' }
}

/**
 * Identité lue dans la session locale (aucun appel réseau, donc aussi hors ligne), tenue à jour quand la session
 * change. `undefined` : pas encore lue ; `null` : pas de session.
 */
export function useProfileUser(client: ProfileClient) {
  const [user, setUser] = useState<ProfileUser | null | undefined>(undefined)
  useEffect(() => {
    let active = true
    client.auth.getSession().then(
      ({ data }) => { if (active) setUser(cur => cur ?? toUser(data.session?.user)) },
      () => { if (active) setUser(cur => cur ?? null) },
    )
    const { data } = client.auth.onAuthStateChange((_event, session) => { if (session) setUser(toUser(session.user)) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [client])
  /** Pseudo enregistré : affiché tout de suite. */
  const setPseudo = useCallback((pseudo: string) => setUser(cur => (cur ? { ...cur, pseudo } : cur)), [])
  return { user, setPseudo }
}
