import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthRetryableFetchError } from '@supabase/supabase-js'
import { App as KApp } from 'konsta/react'
import { LEGACY_TAG_NAMES } from '../../../shared/tags'
import type { ProfileClient } from '../../lib/account'
import { VaultDB } from '../../lib/db'
import { stateFromReviews } from '../../lib/scheduler'
import type { Card, Review } from '../../lib/types'
import { SignedInApp } from '../home/SignedInApp'

// Aucun vrai identifiant, aucun vrai Supabase : le client d'authentification est entièrement simulé.
const EMAIL = 'kyllian@exemple.com'
const CURRENT = 'ancien-mdp-test'
const NEXT = 'nouveau-mdp-test'
const SHORT = 'onze-car-aa' // 11 caractères : refusé
const NOW = new Date('2026-10-19T10:00:00Z')

const card = (id: string, tags: string[], extra: Partial<Card> = {}): Card => ({
  id, source: 'vault', deck: 'x', tags, source_path: `x/${id}.md`, front: `Question ${id} ?`, back: `Réponse ${id}.`,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null, ...extra,
})
const review = (card_id: string, at: string): Review => ({ id: `${card_id}-${at}`, card_id, rating: 3, reviewed_at: at, synced: 1 })
/** Série de « Très bien » espacés : stabilité > 21 jours (carte maîtrisée). */
function masteredStreak(id: string): Review[] {
  const out: Review[] = []
  let at = new Date('2026-01-01T10:00:00Z')
  for (let i = 0; i < 8; i++) { out.push(review(id, at.toISOString())); at = stateFromReviews(out).due }
  return out
}

interface FakeUser { id: string; email: string; user_metadata: Record<string, unknown> }
const USER_ID = 'user-1'
function fakeClient(user: FakeUser | null = { id: USER_ID, email: EMAIL, user_metadata: { pseudo: 'Kyllian' } }) {
  const auth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: user && { user } }, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  }
  return { auth, client: { auth } as unknown as ProfileClient }
}
const failWith = (code: string, status = 400) => ({ data: {}, error: Object.assign(new Error(code), { code, status }) })

let db: VaultDB
const NOTHING = { pushed: 0, pulledCards: 0, pulledReviews: 0 }

beforeEach(async () => {
  window.history.replaceState(null, '')
  db = new VaultDB(`profile-${crypto.randomUUID()}`)
  await db.cards.bulkPut([
    card('a', ['IA & agents']), card('b', ['IA & agents', 'Dev & outils']), card('c', ['Dev & outils']), card('m', ['IA & agents']),
    card('brouillon', ['IA & agents'], { status: 'draft' }),
    card('supprimee', ['IA & agents'], { deleted_at: '2026-10-02T00:00:00Z' }),
  ])
  await db.reviews.bulkPut(masteredStreak('m'))
  await db.tags.bulkPut(Object.values(LEGACY_TAG_NAMES).map((name, i) => ({ id: `t${i}`, name, updated_at: 'u' })))
})
afterEach(async () => { cleanup(); vi.restoreAllMocks(); db.close(); await db.delete() })

function renderApp(client: ProfileClient, over: { runSync?: () => Promise<typeof NOTHING>; onSignOut?: () => void } = {}) {
  const onSignOut = over.onSignOut ?? vi.fn()
  const runSync = over.runSync ?? vi.fn().mockResolvedValue(NOTHING)
  render(<KApp theme="ios"><SignedInApp db={db} runSync={runSync} now={() => NOW} onSignOut={onSignOut} profile={{ client }} /></KApp>)
  return { user: userEvent.setup(), onSignOut, runSync }
}
const heading = () => screen.getByRole('heading', { level: 1 }).textContent
/** Flèche retour : premier bouton de la barre, nommée par l'écran de destination. */
const backArrow = () => document.querySelector('header button') as HTMLElement
const depth = () => (window.history.state as { vaultCardsDepth?: number } | null)?.vaultCardsDepth ?? 0
const settle = () => act(() => new Promise(r => setTimeout(r, 50)))
const goBack = () => { act(() => { window.history.back() }) }

async function openProfile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Profil' }))
  await screen.findByText(EMAIL)
}
async function openEmailForm(user: ReturnType<typeof userEvent.setup>) {
  await openProfile(user)
  await user.click(screen.getByRole('button', { name: "Changer l'e-mail" }))
  return await screen.findByLabelText('Nouvelle adresse e-mail')
}
async function openPasswordForm(user: ReturnType<typeof userEvent.setup>) {
  await openProfile(user)
  await user.click(screen.getByRole('button', { name: 'Changer le mot de passe' }))
  await screen.findByLabelText('Mot de passe actuel')
}
const confirmButton = (name: string) => screen.getByRole('button', { name })

describe('Profil : affichage (#83)', () => {
  it('le bouton de la barre ouvre le Profil : avatar = initiale du pseudo, pseudo, e-mail, 3 compteurs locaux', async () => {
    const { user } = renderApp(fakeClient().client)
    await openProfile(user)
    expect(heading()).toBe('Profil')
    const identity = screen.getByRole('region', { name: 'Identité' })
    expect(within(identity).getByText('K').getAttribute('aria-hidden')).toBe('true') // pas de photo : une initiale
    expect(identity.querySelector('img')).toBeNull()
    expect(within(identity).getByText('Kyllian')).toBeTruthy()
    expect(within(identity).getByText(EMAIL)).toBeTruthy()
    // Cartes actives (ni brouillon ni supprimée), maîtrisées (stabilité ≥ 21 j), tags portés par une carte active (2 sur les 8 du registre).
    await waitFor(() => expect(screen.getByRole('button', { name: '4 Cartes' })).toBeTruthy())
    expect(screen.getByRole('button', { name: '2 Tags' })).toBeTruthy()
    expect(screen.getByText('Maîtrisées').previousElementSibling?.textContent).toBe('1')
    // Sur le Profil, la barre n'a plus de bouton Profil (ni de loupe).
    const header = document.querySelector('header')!
    expect(within(header).queryByRole('button', { name: 'Profil' })).toBeNull()
    expect(within(header).queryByRole('button', { name: 'Rechercher' })).toBeNull()
    expect(within(header).getByRole('status').textContent).toBe('Synchronisé')
  })

  it('sans pseudo : l’avatar prend l’initiale de l’e-mail et le pseudo est à ajouter', async () => {
    const { user } = renderApp(fakeClient({ id: USER_ID, email: 'zoe@exemple.com', user_metadata: {} }).client)
    await user.click(await screen.findByRole('button', { name: 'Profil' }))
    await screen.findByText('zoe@exemple.com')
    expect(within(screen.getByRole('region', { name: 'Identité' })).getByText('Z')).toBeTruthy()
    expect(screen.getByText('Ajoute un pseudo')).toBeTruthy()
  })

  it('« Maîtrisées » est un simple compteur ; « Cartes › » et « Tags › » sont des boutons à cible ≥ 44 px', async () => {
    const { user } = renderApp(fakeClient().client)
    await openProfile(user)
    expect(screen.queryByRole('button', { name: /Maîtrisées/ })).toBeNull()
    for (const b of [screen.getByRole('button', { name: /Cartes/ }), screen.getByRole('button', { name: /Tags/ })]) expect(b.className).toContain('min-h-[76px]')
    expect(screen.getByRole('button', { name: 'Modifier le pseudo' }).className).toContain('size-11')
  })

  it('sans client de profil fourni : pas de bouton Profil dans la barre', async () => {
    render(<KApp theme="ios"><SignedInApp db={db} runSync={vi.fn()} now={() => NOW} onSignOut={vi.fn()} /></KApp>)
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('button', { name: 'Profil' })).toBeNull()
  })
})

describe('Profil : navigation (#83)', () => {
  it('Profil est un niveau : le retour (flèche ou geste) revient à l’accueil, historique aligné', async () => {
    const { user } = renderApp(fakeClient().client)
    await openProfile(user)
    expect(depth()).toBe(1)
    goBack()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Profil' })).toBeTruthy())
    await waitFor(() => expect(depth()).toBe(0))
    await user.click(screen.getByRole('button', { name: 'Profil' }))
    await screen.findByText(EMAIL)
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Profil' })).toBeTruthy())
    await settle()
    expect(depth()).toBe(0)
  })

  it('« Cartes › » ouvre Mes cartes, « Tags › » ouvre Mes tags ; la flèche ramène au Profil', async () => {
    const { user } = renderApp(fakeClient().client)
    await openProfile(user)
    await user.click(await screen.findByRole('button', { name: '4 Cartes' }))
    await waitFor(() => expect(heading()).toBe('Mes cartes'))
    await user.click(backArrow()) // flèche nommée par l'écran de destination (« Profil »)
    await waitFor(() => expect(heading()).toBe('Profil'))
    await user.click(screen.getByRole('button', { name: '2 Tags' }))
    await waitFor(() => expect(heading()).toBe('Mes tags'))
    await user.click(backArrow())
    await waitFor(() => expect(heading()).toBe('Profil'))
    await screen.findByText(EMAIL)
  })
})

describe('Profil : pseudo (#83)', () => {
  it('crayon → champ ; espaces de bord retirés ; enregistré dans les métadonnées de l’utilisateur (sans table)', async () => {
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    await openProfile(user)
    await user.click(screen.getByRole('button', { name: 'Modifier le pseudo' }))
    const input = screen.getByLabelText('Pseudo')
    await user.clear(input)
    await user.type(input, '  Zoé  ')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le pseudo' }))
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledWith({ data: { pseudo: 'Zoé' } }))
    expect(await screen.findByText('Zoé')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Identité' })).getByText('Z')).toBeTruthy()
    expect(screen.queryByLabelText('Pseudo')).toBeNull()
  })

  it('vide ou de plus de 40 caractères : message en français, rien n’est envoyé', async () => {
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    await openProfile(user)
    await user.click(screen.getByRole('button', { name: 'Modifier le pseudo' }))
    const input = screen.getByLabelText('Pseudo')
    await user.clear(input)
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le pseudo' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Le pseudo doit faire de 1 à 40 caractères.')
    await user.clear(input)
    await user.type(input, 'a'.repeat(41))
    await user.click(screen.getByRole('button', { name: 'Enregistrer le pseudo' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Le pseudo doit faire de 1 à 40 caractères.'))
    await user.clear(input)
    await user.type(input, 'a'.repeat(40))
    await user.click(screen.getByRole('button', { name: 'Enregistrer le pseudo' }))
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledTimes(1))
  })

  it('échec serveur : message, le champ reste ouvert ; Échap annule sans rien envoyer', async () => {
    const fake = fakeClient()
    fake.auth.updateUser.mockResolvedValueOnce(failWith('unexpected_failure', 500))
    const { user } = renderApp(fake.client)
    await openProfile(user)
    await user.click(screen.getByRole('button', { name: 'Modifier le pseudo' }))
    await user.type(screen.getByLabelText('Pseudo'), 'x')
    await user.click(screen.getByRole('button', { name: 'Enregistrer le pseudo' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Le pseudo n'a pas pu être enregistré. Réessaie.")
    expect(screen.getByLabelText('Pseudo')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('Pseudo')).toBeNull()
    expect(screen.getByText('Kyllian')).toBeTruthy()
    expect(fake.auth.updateUser).toHaveBeenCalledTimes(1)
  })
})

describe('Profil : changer l’e-mail (#83)', () => {
  it('rappel de l’adresse actuelle ; appel avec redirection vers l’origine de l’app ; message de confirmation sur le Profil', async () => {
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    const input = await openEmailForm(user)
    expect(heading()).toBe('Adresse e-mail')
    expect(screen.getByText('Adresse actuelle').nextElementSibling?.textContent).toBe(EMAIL)
    expect(input.getAttribute('autocomplete')).toBe('email')
    expect(confirmButton('Envoyer le lien').hasAttribute('disabled')).toBe(true) // vide : ✓ gris
    await user.type(input, '  nouveau@exemple.com ')
    await user.click(confirmButton('Envoyer le lien'))
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledWith({ email: 'nouveau@exemple.com' }, { emailRedirectTo: window.location.origin }))
    await waitFor(() => expect(heading()).toBe('Profil'))
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe("Un lien a été envoyé à nouveau@exemple.com. Valide-le pour changer d'adresse. L'actuelle reste active jusque-là.")
    await settle()
    expect(depth()).toBe(1)
  })

  it('adresse invalide ou identique à l’actuelle (casse ignorée) : message, rien n’est envoyé', async () => {
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    const input = await openEmailForm(user)
    await user.type(input, 'pas-une-adresse')
    await user.click(confirmButton('Envoyer le lien'))
    expect((await screen.findByRole('alert')).textContent).toBe("Cette adresse e-mail n'est pas valide.")
    await user.clear(input)
    await user.type(input, 'KYLLIAN@exemple.com')
    await user.click(confirmButton('Envoyer le lien'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("C'est déjà ton adresse actuelle."))
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })

  it.each([
    ['limite d’envoi atteinte', () => failWith('over_email_send_rate_limit', 429), "Trop d'e-mails envoyés pour l'instant. Réessaie dans quelques minutes."],
    ['adresse déjà utilisée', () => failWith('email_exists', 422), 'Cette adresse est déjà utilisée.'],
    ['adresse refusée par le serveur', () => failWith('email_address_invalid', 400), "Cette adresse e-mail n'est pas valide."],
    ['panne réseau', () => ({ data: {}, error: new AuthRetryableFetchError('Failed to fetch', 0) }), 'Pas de connexion. Réessaie quand tu as du réseau.'],
    ['erreur inconnue', () => failWith('unexpected_failure', 500), "L'adresse n'a pas pu être modifiée. Réessaie."],
  ])('erreur serveur (%s) : message en français, on reste sur le formulaire', async (_name, result, message) => {
    const fake = fakeClient()
    fake.auth.updateUser.mockResolvedValueOnce(result())
    const { user } = renderApp(fake.client)
    const input = await openEmailForm(user)
    await user.type(input, 'nouveau@exemple.com')
    await user.click(confirmButton('Envoyer le lien'))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(heading()).toBe('Adresse e-mail')
    expect((input as HTMLInputElement).value).toBe('nouveau@exemple.com')
  })

  it('retour avec une saisie (#88) : le geste ouvre la confirmation, « Ignorer » revient au Profil ; sans saisie, retour direct', async () => {
    const { user } = renderApp(fakeClient().client)
    const input = await openEmailForm(user)
    goBack() // sans saisie : direct
    await waitFor(() => expect(heading()).toBe('Profil'))
    await screen.findByText(EMAIL)
    await user.click(screen.getByRole('button', { name: "Changer l'e-mail" }))
    await user.type(await screen.findByLabelText('Nouvelle adresse e-mail'), 'abc')
    goBack()
    expect((await screen.findByRole('alertdialog')).textContent).toMatch('Tes modifications ne seront pas enregistrées.')
    await settle()
    expect(heading()).toBe('Adresse e-mail')
    expect(depth()).toBe(2)
    await user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect((screen.getByLabelText('Nouvelle adresse e-mail') as HTMLInputElement).value).toBe('abc')
    await user.click(screen.getByRole('button', { name: 'Fermer' })) // ✕ avec saisie : même confirmation
    await user.click(await screen.findByRole('button', { name: 'Ignorer les modifications' }))
    await waitFor(() => expect(heading()).toBe('Profil'))
    expect(input.isConnected).toBe(false)
  })
})

describe('Profil : changer le mot de passe (#83)', () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm: string) => {
    await user.type(screen.getByLabelText('Mot de passe actuel'), current)
    await user.type(screen.getByLabelText('Nouveau mot de passe'), next)
    await user.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), confirm)
  }

  it('champs avec autocomplete adapté et un œil par champ (afficher / masquer)', async () => {
    const { user } = renderApp(fakeClient().client)
    await openPasswordForm(user)
    expect(heading()).toBe('Mot de passe')
    const fields = ['Mot de passe actuel', 'Nouveau mot de passe', 'Confirmer le nouveau mot de passe'].map(l => screen.getByLabelText(l))
    expect(fields.map(f => f.getAttribute('autocomplete'))).toEqual(['current-password', 'new-password', 'new-password'])
    expect(fields.every(f => f.getAttribute('type') === 'password')).toBe(true)
    const eye = screen.getByRole('button', { name: 'Afficher le mot de passe actuel' })
    expect(eye.className).toContain('h-11')
    await user.type(fields[0]!, 'abc')
    await user.click(eye)
    expect(fields[0]!.getAttribute('type')).toBe('text')
    expect(fields[1]!.getAttribute('type')).toBe('password') // les autres champs restent masqués
    expect(screen.getByRole('button', { name: 'Masquer le mot de passe actuel' }).getAttribute('aria-pressed')).toBe('true')
    expect((fields[0] as HTMLInputElement).value).toBe('abc')
    expect(screen.getByText('12 caractères minimum.')).toBeTruthy()
  })

  it('succès : l’actuel est vérifié par une reconnexion avec l’e-mail courant, puis le nouveau est enregistré', async () => {
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    await openPasswordForm(user)
    expect(confirmButton('Enregistrer').hasAttribute('disabled')).toBe(true)
    await fill(user, CURRENT, NEXT, NEXT)
    await user.click(confirmButton('Enregistrer'))
    await waitFor(() => expect(fake.auth.updateUser).toHaveBeenCalledWith({ password: NEXT }))
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: CURRENT })
    expect(fake.auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(fake.auth.updateUser.mock.invocationCallOrder[0]!)
    await waitFor(() => expect(heading()).toBe('Profil'))
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe('Mot de passe modifié.')
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'others' }) // les autres appareils se reconnectent
  })

  it('mauvais mot de passe actuel : message, le nouveau n’est jamais envoyé', async () => {
    const fake = fakeClient()
    fake.auth.signInWithPassword.mockResolvedValueOnce(failWith('invalid_credentials'))
    const { user } = renderApp(fake.client)
    await openPasswordForm(user)
    await fill(user, 'mauvais-mdp', NEXT, NEXT)
    await user.click(confirmButton('Enregistrer'))
    expect((await screen.findByRole('alert')).textContent).toBe('Mot de passe actuel incorrect.')
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
    expect(heading()).toBe('Mot de passe')
  })

  it('confirmation différente, moins de 12 caractères, identique à l’actuel : message, aucun appel', async () => {
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    await openPasswordForm(user)
    await fill(user, CURRENT, NEXT, `${NEXT}x`)
    await user.click(confirmButton('Enregistrer'))
    expect((await screen.findByRole('alert')).textContent).toBe('Les deux mots de passe ne correspondent pas.')
    await user.clear(screen.getByLabelText('Nouveau mot de passe'))
    await user.clear(screen.getByLabelText('Confirmer le nouveau mot de passe'))
    await user.type(screen.getByLabelText('Nouveau mot de passe'), SHORT)
    await user.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), SHORT)
    await user.click(confirmButton('Enregistrer'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Le nouveau mot de passe doit faire au moins 12 caractères.'))
    await user.clear(screen.getByLabelText('Nouveau mot de passe'))
    await user.clear(screen.getByLabelText('Confirmer le nouveau mot de passe'))
    await user.type(screen.getByLabelText('Nouveau mot de passe'), CURRENT)
    await user.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), CURRENT)
    await user.click(confirmButton('Enregistrer'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("Le nouveau mot de passe doit être différent de l'actuel."))
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled()
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })

  it.each([
    ['trop de tentatives', 'signIn', () => failWith('over_request_rate_limit', 429), 'Trop de tentatives. Réessaie dans quelques minutes.'],
    ['panne réseau à la vérification', 'signIn', () => ({ data: {}, error: new AuthRetryableFetchError('Failed to fetch', 0) }), 'Pas de connexion. Réessaie quand tu as du réseau.'],
    ['mot de passe trop faible (serveur)', 'update', () => failWith('weak_password', 422), 'Mot de passe trop faible : choisis-en un plus long ou plus varié.'],
    ['identique côté serveur', 'update', () => failWith('same_password', 422), "Le nouveau mot de passe doit être différent de l'actuel."],
    ['erreur inconnue', 'update', () => failWith('unexpected_failure', 500), "Le mot de passe n'a pas pu être modifié. Réessaie."],
  ])('erreur serveur (%s) : message en français', async (_name, step, result, message) => {
    const fake = fakeClient()
    ;(step === 'signIn' ? fake.auth.signInWithPassword : fake.auth.updateUser).mockResolvedValueOnce(result())
    const { user } = renderApp(fake.client)
    await openPasswordForm(user)
    await fill(user, CURRENT, NEXT, NEXT)
    await user.click(confirmButton('Enregistrer'))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(heading()).toBe('Mot de passe')
  })

  it('aucun mot de passe dans la console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => {}))
    const fake = fakeClient()
    fake.auth.signInWithPassword.mockResolvedValueOnce(failWith('invalid_credentials'))
    const { user } = renderApp(fake.client)
    await openPasswordForm(user)
    await fill(user, CURRENT, NEXT, NEXT)
    await user.click(confirmButton('Enregistrer'))
    await screen.findByRole('alert')
    for (const s of spies) for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toMatch(new RegExp(`${CURRENT}|${NEXT}`))
  })
})

describe('Profil : garde du pseudo et compte étranger (#83)', () => {
  it('pseudo modifié puis retour (geste ou flèche) : confirmation, « Continuer » garde la saisie, « Ignorer » revient', async () => {
    const { user } = renderApp(fakeClient().client)
    await openProfile(user)
    await user.click(screen.getByRole('button', { name: 'Modifier le pseudo' }))
    await user.type(screen.getByLabelText('Pseudo'), 'x')
    goBack()
    expect((await screen.findByRole('alertdialog')).textContent).toMatch('Tes modifications ne seront pas enregistrées.')
    await settle()
    expect(heading()).toBe('Profil')
    await user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect((screen.getByLabelText('Pseudo') as HTMLInputElement).value).toBe('Kyllianx')
    await user.click(backArrow()) // la flèche passe par la même confirmation
    await user.click(await screen.findByRole('button', { name: 'Ignorer les modifications' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull())
  })

  it('pseudo ouvert sans modification : le retour est immédiat', async () => {
    const { user } = renderApp(fakeClient().client)
    await openProfile(user)
    await user.click(screen.getByRole('button', { name: 'Modifier le pseudo' }))
    goBack()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('la reconnexion ouvre un autre compte : déconnexion de cette session, message clair, mot de passe jamais changé', async () => {
    const fake = fakeClient()
    fake.auth.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: 'autre-compte' } }, error: null })
    const { user } = renderApp(fake.client)
    await openPasswordForm(user)
    await user.type(screen.getByLabelText('Mot de passe actuel'), CURRENT)
    await user.type(screen.getByLabelText('Nouveau mot de passe'), NEXT)
    await user.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), NEXT)
    await user.click(confirmButton('Enregistrer'))
    expect((await screen.findByRole('alert')).textContent).toMatch('autre compte')
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })
})

describe('Profil : hors ligne (#83)', () => {
  it('e-mail et mot de passe : ✓ désactivé et message, rien ne part ; le retour en ligne réactive', async () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    const input = await openEmailForm(user)
    expect(screen.getByRole('status').textContent).toBe('Pas de connexion. Réessaie quand tu as du réseau.')
    await user.type(input, 'nouveau@exemple.com')
    expect(confirmButton('Envoyer le lien').hasAttribute('disabled')).toBe(true)
    await user.type(input, '{Enter}') // Entrée ne contourne pas non plus
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
    onLine.mockReturnValue(true)
    act(() => { window.dispatchEvent(new Event('online')) })
    await waitFor(() => expect(confirmButton('Envoyer le lien').hasAttribute('disabled')).toBe(false))
    expect(screen.queryByText('Pas de connexion. Réessaie quand tu as du réseau.')).toBeNull()
  })

  it('mot de passe hors ligne : aucune reconnexion ni changement', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    await openPasswordForm(user)
    await user.type(screen.getByLabelText('Mot de passe actuel'), CURRENT)
    await user.type(screen.getByLabelText('Nouveau mot de passe'), NEXT)
    await user.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), `${NEXT}{Enter}`)
    expect(confirmButton('Enregistrer').hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('status').textContent).toMatch('Pas de connexion')
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled()
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })

  it('pseudo hors ligne : enregistrement désactivé avec un message, rien n’est envoyé', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fake = fakeClient()
    const { user } = renderApp(fake.client)
    await openProfile(user) // le Profil se lit dans la session locale : il s'ouvre hors ligne
    await user.click(screen.getByRole('button', { name: 'Modifier le pseudo' }))
    await user.type(screen.getByLabelText('Pseudo'), 'x')
    expect(screen.getByRole('button', { name: 'Enregistrer le pseudo' }).hasAttribute('disabled')).toBe(true)
    expect(within(screen.getByRole('main')).getByRole('status').textContent).toBe('Pas de connexion. Réessaie quand tu as du réseau.')
    await user.keyboard('{Enter}')
    expect(fake.auth.updateUser).not.toHaveBeenCalled()
  })
})

describe('Profil : déconnexion (#83)', () => {
  it('bouton en bas, en verre à contour rouge (cible ≥ 44 px), qui lance la déconnexion sûre existante', async () => {
    const { user, onSignOut } = renderApp(fakeClient().client)
    await openProfile(user)
    const out = screen.getByRole('button', { name: 'Se déconnecter' })
    expect(out.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-again', 'h-14']))
    expect(out.className).toContain('[--glass-btn-label:var(--again)]')
    await user.click(out)
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1))
  })

  it('révisions pas encore synchronisées et synchro impossible : confirmation (#40) ; refus = on reste connecté', async () => {
    await db.reviews.put({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-19T09:00:00Z', synced: 0 })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { user, onSignOut, runSync } = renderApp(fakeClient().client, { runSync: vi.fn().mockRejectedValue(new Error('hors ligne')) })
    await openProfile(user)
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(runSync).toHaveBeenCalled()
    expect(onSignOut).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    await waitFor(() => expect(onSignOut).toHaveBeenCalledTimes(1))
  })
})
