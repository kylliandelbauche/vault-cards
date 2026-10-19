import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { LoginScreen } from './LoginScreen'

const renderLogin = (signIn: (e: string, p: string) => Promise<{ error: string | null }>) =>
  render(<KApp theme="ios"><LoginScreen signIn={signIn} /></KApp>)

afterEach(cleanup)

describe('LoginScreen', () => {
  it('champs compatibles avec le remplissage automatique iOS', () => {
    renderLogin(vi.fn())
    const email = screen.getByLabelText('E-mail')
    const password = screen.getByLabelText('Mot de passe')
    expect(email.getAttribute('type')).toBe('email')
    expect(password.getAttribute('type')).toBe('password')
    expect(email.getAttribute('autocomplete')).toBe('username')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
  })

  it('envoie les identifiants et affiche le message d’erreur', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: 'E-mail ou mot de passe incorrect.' })
    renderLogin(signIn)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('E-mail'), ' moi@exemple.be ')
    await user.type(screen.getByLabelText('Mot de passe'), 'faux')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(signIn).toHaveBeenCalledWith('moi@exemple.be', 'faux')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'E-mail ou mot de passe incorrect.')
    expect(screen.getByRole('button', { name: 'Se connecter' })).toHaveProperty('disabled', false)
  })

  it('Liquid Glass (#39) : champs dans un bloc en verre, « Se connecter » en dehors, bouton en verre bleu', () => {
    renderLogin(vi.fn())
    const fields = screen.getByTestId('login-fields')
    const button = screen.getByRole('button', { name: 'Se connecter' })
    expect(fields.className.split(' ')).toContain('glass-card')
    expect(fields.contains(screen.getByLabelText('E-mail'))).toBe(true)
    expect(fields.contains(screen.getByLabelText('Mot de passe'))).toBe(true)
    expect(fields.contains(button)).toBe(false)
    expect(button.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-new', 'h-14']))
    expect(button.getAttribute('type')).toBe('submit')
    expect(button.closest('form')).toBe(fields.closest('form'))
    // 2 surfaces floutées, aucune imbriquée.
    expect(document.querySelectorAll('.glass, .glass-card, .glass-btn')).toHaveLength(2)
    expect(button.closest('.glass, .glass-card')).toBeNull()
  })

  it('Entrée dans le mot de passe soumet le formulaire ; bouton désactivé pendant l’envoi', async () => {
    let resolve!: (v: { error: string | null }) => void
    const signIn = vi.fn(() => new Promise<{ error: string | null }>(r => { resolve = r }))
    renderLogin(signIn)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('E-mail'), 'moi@exemple.be')
    await user.type(screen.getByLabelText('Mot de passe'), 'secret{Enter}')
    expect(signIn).toHaveBeenCalledWith('moi@exemple.be', 'secret')
    const button = screen.getByRole('button', { name: 'Connexion en cours' })
    expect(button).toHaveProperty('disabled', true)
    await act(async () => resolve({ error: 'Réseau indisponible.' }))
    expect(screen.getByRole('alert').textContent).toBe('Réseau indisponible.')
    expect(screen.getByRole('button', { name: 'Se connecter' })).toHaveProperty('disabled', false)
  })

  it('œil (#84) : affiche / masque le mot de passe sans soumettre le formulaire', async () => {
    const signIn = vi.fn()
    renderLogin(signIn)
    const user = userEvent.setup()
    const password = screen.getByLabelText('Mot de passe')
    await user.type(password, 'secret')
    const show = screen.getByRole('button', { name: 'Afficher le mot de passe' })
    expect(show.getAttribute('type')).toBe('button')
    expect(show.getAttribute('aria-pressed')).toBe('false')
    expect(show.closest('[data-testid="login-fields"]')).not.toBeNull()
    await user.click(show)
    expect(password.getAttribute('type')).toBe('text')
    expect(password).toHaveProperty('value', 'secret')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
    const hide = screen.getByRole('button', { name: 'Masquer le mot de passe' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')
    await user.click(hide)
    expect(password.getAttribute('type')).toBe('password')
    expect(screen.getByRole('button', { name: 'Afficher le mot de passe' })).toBeTruthy()
    expect(signIn).not.toHaveBeenCalled()
  })
})
