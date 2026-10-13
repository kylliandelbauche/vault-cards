import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { VaultDB } from '../../lib/db'
import type { Card } from '../../lib/types'
import { SignedInApp } from './SignedInApp'

const card = (id: string, tags: string[]): Card => ({
  id, deck: 'x', tags, source_path: `x/${id}.md`, front: `Question ${id} ?`, back: `Réponse ${id}.`,
  updated_at: '2026-10-01T00:00:00Z', deleted_at: null,
})
// Horloge qui avance d'une seconde à chaque lecture : chaque tap tombe après la garde anti double tap.
let t = Date.parse('2026-10-13T10:00:00Z')
const now = () => new Date((t += 1000))

let db: VaultDB
const NOTHING = { pushed: 0, pulledCards: 0, pulledReviews: 0 }

beforeEach(async () => {
  window.history.replaceState(null, '')
  db = new VaultDB(`shell-${crypto.randomUUID()}`)
  await db.cards.bulkPut([card('a', ['ia']), card('b', ['ia', 'dev']), card('c', ['dev'])])
})
afterEach(async () => { cleanup(); db.close(); await db.delete() })

function renderApp(runSync = vi.fn().mockResolvedValue(NOTHING)) {
  render(<KApp theme="ios"><SignedInApp db={db} runSync={runSync} now={now} onSignOut={vi.fn()} /></KApp>)
  return { runSync, user: userEvent.setup() }
}
const heading = () => screen.getByRole('heading', { level: 1 }).textContent

async function rateAll(user: ReturnType<typeof userEvent.setup>) {
  while (screen.queryByRole('button', { name: 'Afficher la réponse' })) {
    await user.click(screen.getByRole('button', { name: 'Afficher la réponse' }))
    await user.click(await screen.findByRole('button', { name: /Très bien/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Très bien/ })).toBeNull())
  }
}

describe('SignedInApp : navigation (#53)', () => {
  it('l’accueil s’affiche à l’ouverture ; accueil → révision → fin → accueil, compteurs recalculés', async () => {
    const { user, runSync } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    expect(await screen.findByRole('button', { name: 'Afficher la réponse' })).toBeTruthy()
    expect(document.querySelector('header p')?.textContent).toBe('Vault Cards')
    await rateAll(user)
    expect(await screen.findByText('Session terminée')).toBeTruthy()
    await waitFor(() => expect(runSync.mock.calls.length).toBeGreaterThanOrEqual(2)) // fin de session : notes poussées
    await user.click(screen.getByRole('button', { name: "Retour à l'accueil" }))
    await waitFor(() => expect(heading()).toBe("Aucune carte à revoir aujourd'hui"))
    expect(screen.getByRole('button', { name: 'Réviser à nouveau' })).toBeTruthy()
  })

  it('tap sur un tag : session limitée au tag, nom du tag dans la barre ; chevron → accueil', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Dev & outils, 2 cartes' }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    expect(document.querySelector('header p')?.textContent).toBe('🛠️ Dev & outils')
    const seen = new Set<string>()
    while (screen.queryByRole('button', { name: 'Afficher la réponse' })) {
      seen.add(document.querySelector('article p.mt-3')!.textContent!)
      await user.click(screen.getByRole('button', { name: 'Afficher la réponse' }))
      await user.click(await screen.findByRole('button', { name: /Très bien/ }))
      await waitFor(() => expect(screen.queryByRole('button', { name: /Très bien/ })).toBeNull())
    }
    expect([...seen].sort()).toEqual(['Question b ?', 'Question c ?'])
    await user.click(within(document.querySelector('header')!).getByRole('button', { name: 'Accueil' }))
    await waitFor(() => expect(heading()).toBe("1 carte à revoir aujourd'hui")) // il reste 'a' (IA)
  })

  it('tags sans carte : grisés et non cliquables', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Culture, 0 carte' }))
    expect(screen.queryByRole('button', { name: 'Afficher la réponse' })).toBeNull()
    expect(heading()).toBe("3 cartes à revoir aujourd'hui")
  })

  it('retour au milieu d’une session : accueil à jour et notes déjà données poussées tout de suite', async () => {
    const { user, runSync } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    await user.click(await screen.findByRole('button', { name: 'Afficher la réponse' }))
    await user.click(await screen.findByRole('button', { name: /Très bien/ }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    await waitFor(() => expect(heading()).toBe("2 cartes à revoir aujourd'hui"))
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2))
  })

  it('bouton « précédent » du navigateur pendant la révision : retour à l’accueil', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    window.history.back()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Commencer à étudier' })).toBeTruthy())
  })

  it('l’accueil se met à jour après une synchro qui ramène des cartes', async () => {
    renderApp(vi.fn().mockImplementation(async () => {
      await db.cards.put(card('d', ['culture']))
      return { pushed: 0, pulledCards: 1, pulledReviews: 0 }
    }))
    await waitFor(() => expect(heading()).toBe("4 cartes à revoir aujourd'hui"))
    expect(screen.getByRole('button', { name: 'Culture, 1 carte' }).hasAttribute('aria-disabled')).toBe(false)
  })
})
