import { describe, it, expect, vi } from 'vitest'
import { AuthRetryableFetchError } from '@supabase/supabase-js'
import { AccountError, changePassword, MIN_PASSWORD, changePseudo, requestEmailChange, type ProfileClient, type ProfileDeps } from './account'

// Client d'authentification entièrement simulé : aucun réseau, aucun vrai identifiant.
const WHO = { id: 'user-1', email: 'kyllian@exemple.com' }
const failure = (code: string, status: number) => ({ data: {}, error: Object.assign(new Error(code), { code, status }) })
const network = () => ({ data: {}, error: new AuthRetryableFetchError('Failed to fetch', 0) })

function deps(online = true) {
  const auth = {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: WHO.id } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }
  const d: ProfileDeps = { client: { auth } as unknown as ProfileClient, online: () => online }
  return { auth, d }
}
const message = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (err: unknown) => err)
  expect(e).toBeInstanceOf(AccountError)
  return (e as AccountError).message
}

describe('changePassword (#83)', () => {
  it('succès (12 caractères, le minimum) : reconnexion avec l’e-mail courant, puis nouveau mot de passe, puis autres appareils déconnectés', async () => {
    const { auth, d } = deps()
    await changePassword(d, WHO, 'ancien-test', 'nouveau-test', 'nouveau-test')
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: WHO.email, password: 'ancien-test' })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'nouveau-test' })
    expect(auth.signOut).toHaveBeenCalledTimes(1)
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'others' })
    const order = [auth.signInWithPassword, auth.updateUser, auth.signOut].map(f => f.mock.invocationCallOrder[0]!)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('l’échec de la déconnexion des autres appareils ne défait pas le changement', async () => {
    const { auth, d } = deps()
    auth.signOut.mockRejectedValueOnce(new Error('réseau'))
    await expect(changePassword(d, WHO, 'ancien-test', 'nouveau-test', 'nouveau-test')).resolves.toBeUndefined()
  })

  it('« incorrect » seulement pour invalid_credentials', async () => {
    const { auth, d } = deps()
    auth.signInWithPassword.mockResolvedValueOnce(failure('invalid_credentials', 400))
    expect(await message(changePassword(d, WHO, 'x-ancien', 'nouveau-test', 'nouveau-test'))).toBe('Mot de passe actuel incorrect.')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it.each([
    ['429 (limite)', () => failure('over_request_rate_limit', 429), 'Trop de tentatives. Réessaie dans quelques minutes.'],
    ['500', () => failure('unexpected_failure', 500), "Le mot de passe actuel n'a pas pu être vérifié. Réessaie."],
    ['e-mail non confirmé', () => failure('email_not_confirmed', 400), "Le mot de passe actuel n'a pas pu être vérifié. Réessaie."],
    ['réseau', network, 'Pas de connexion. Réessaie quand tu as du réseau.'],
  ])('vérification de l’actuel : %s → message dédié, jamais « incorrect », aucun changement', async (_n, result, expected) => {
    const { auth, d } = deps()
    auth.signInWithPassword.mockResolvedValueOnce(result())
    expect(await message(changePassword(d, WHO, 'ancien-test', 'nouveau-test', 'nouveau-test'))).toBe(expected)
    expect(auth.updateUser).not.toHaveBeenCalled()
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('la reconnexion ouvre un autre compte : session étrangère fermée, arrêt avant updateUser', async () => {
    const { auth, d } = deps()
    auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: 'autre' } }, error: null })
    expect(await message(changePassword(d, WHO, 'ancien-test', 'nouveau-test', 'nouveau-test'))).toMatch('autre compte')
    expect(auth.signOut).toHaveBeenCalledTimes(1)
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('sans utilisateur dans la réponse de reconnexion : même arrêt', async () => {
    const { auth, d } = deps()
    auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: null })
    await message(changePassword(d, WHO, 'ancien-test', 'nouveau-test', 'nouveau-test'))
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it.each([
    ['429', () => failure('over_request_rate_limit', 429), 'Trop de demandes. Réessaie dans quelques minutes.'],
    ['500', () => failure('unexpected_failure', 500), "Le mot de passe n'a pas pu être modifié. Réessaie."],
    ['réseau', network, 'Pas de connexion. Réessaie quand tu as du réseau.'],
    ['trop faible', () => failure('weak_password', 422), 'Mot de passe trop faible : choisis-en un plus long ou plus varié.'],
  ])('enregistrement : %s → message en français, autres appareils intacts', async (_n, result, expected) => {
    const { auth, d } = deps()
    auth.updateUser.mockResolvedValueOnce(result())
    expect(await message(changePassword(d, WHO, 'ancien-test', 'nouveau-test', 'nouveau-test'))).toBe(expected)
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('contrôles locaux et hors ligne : rien ne part', async () => {
    const { auth, d } = deps()
    expect(await message(changePassword(d, WHO, 'ancien-test', 'onze-car-aa', 'onze-car-aa'))).toMatch('au moins 12') // 11 caractères
    expect(MIN_PASSWORD).toBe(12)
    expect(await message(changePassword(d, WHO, 'ancien-test', 'nouveau-test', 'autre-test'))).toMatch('ne correspondent pas')
    expect(await message(changePassword(d, WHO, 'meme-mdp-test', 'meme-mdp-test', 'meme-mdp-test'))).toMatch('différent')
    const off = deps(false)
    expect(await message(changePassword(off.d, WHO, 'ancien-test', 'nouveau-test', 'nouveau-test'))).toMatch('Pas de connexion')
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(off.auth.signInWithPassword).not.toHaveBeenCalled()
  })
})

describe('requestEmailChange (#83)', () => {
  it('succès : adresse nettoyée, redirection vers l’origine de l’app', async () => {
    const { auth, d } = deps()
    expect(await requestEmailChange(d, WHO.email, '  nouveau@exemple.com ')).toBe('nouveau@exemple.com')
    expect(auth.updateUser).toHaveBeenCalledWith({ email: 'nouveau@exemple.com' }, { emailRedirectTo: window.location.origin })
  })

  it.each(['', 'pas-une-adresse', 'a@b', 'a b@c.fr'])('adresse invalide « %s » : rien n’est envoyé', async bad => {
    const { auth, d } = deps()
    expect(await message(requestEmailChange(d, WHO.email, bad))).toBe("Cette adresse e-mail n'est pas valide.")
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('identique à l’actuelle (casse et espaces ignorés) : rien n’est envoyé', async () => {
    const { auth, d } = deps()
    expect(await message(requestEmailChange(d, WHO.email, ' KYLLIAN@exemple.com '))).toBe("C'est déjà ton adresse actuelle.")
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('hors ligne : rien ne part', async () => {
    const { auth, d } = deps(false)
    expect(await message(requestEmailChange(d, WHO.email, 'nouveau@exemple.com'))).toMatch('Pas de connexion')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it.each([
    ['429', () => failure('over_email_send_rate_limit', 429), "Trop d'e-mails envoyés pour l'instant. Réessaie dans quelques minutes."],
    ['déjà utilisée', () => failure('email_exists', 422), 'Cette adresse est déjà utilisée.'],
    ['refusée', () => failure('email_address_not_authorized', 400), "Cette adresse n'est pas autorisée."],
    ['500', () => failure('unexpected_failure', 500), "L'adresse n'a pas pu être modifiée. Réessaie."],
    ['réseau', network, 'Pas de connexion. Réessaie quand tu as du réseau.'],
  ])('erreur serveur %s : message en français', async (_n, result, expected) => {
    const { auth, d } = deps()
    auth.updateUser.mockResolvedValueOnce(result())
    expect(await message(requestEmailChange(d, WHO.email, 'nouveau@exemple.com'))).toBe(expected)
  })
})

describe('changePseudo (#83)', () => {
  it('pseudo nettoyé, enregistré dans les métadonnées', async () => {
    const { auth, d } = deps()
    expect(await changePseudo(d, '  Zoé ')).toBe('Zoé')
    expect(auth.updateUser).toHaveBeenCalledWith({ data: { pseudo: 'Zoé' } })
  })
  it.each(['', '   ', 'a'.repeat(41)])('« %s » refusé sans appel', async bad => {
    const { auth, d } = deps()
    expect(await message(changePseudo(d, bad))).toBe('Le pseudo doit faire de 1 à 40 caractères.')
    expect(auth.updateUser).not.toHaveBeenCalled()
  })
})
