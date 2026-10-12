import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { LoginScreen } from './LoginScreen'

const renderLogin = (signIn: (e: string, p: string) => Promise<{ error: string | null }>) =>
  render(<KApp theme="ios"><LoginScreen signIn={signIn} /></KApp>)

afterEach(cleanup)

describe('LoginScreen', () => {
  it('champs compatibles avec le remplissage automatique iOS', () => {
    const { container } = renderLogin(vi.fn())
    const email = container.querySelector('input[type="email"]')!
    const password = container.querySelector('input[type="password"]')!
    expect(email.getAttribute('autocomplete')).toBe('username')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
  })

  it('envoie les identifiants et affiche le message d’erreur', async () => {
    const signIn = vi.fn().mockResolvedValue({ error: 'E-mail ou mot de passe incorrect.' })
    const { container } = renderLogin(signIn)
    const user = userEvent.setup()
    await user.type(container.querySelector('input[type="email"]')!, ' moi@exemple.be ')
    await user.type(container.querySelector('input[type="password"]')!, 'faux')
    await user.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(signIn).toHaveBeenCalledWith('moi@exemple.be', 'faux')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'E-mail ou mot de passe incorrect.')
    expect(screen.getByRole('button', { name: 'Se connecter' })).toHaveProperty('disabled', false)
  })
})
