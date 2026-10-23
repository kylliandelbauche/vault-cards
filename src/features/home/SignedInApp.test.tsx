import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { LEGACY_TAG_NAMES } from '../../../shared/tags'
import { VaultDB } from '../../lib/db'
import type { Card } from '../../lib/types'
import { SignedInApp } from './SignedInApp'

// Tags donnés par leur ancien slug (lisibilité), stockés sous leur nom (#79).
const card = (id: string, tags: string[]): Card => ({
  id, source: 'vault', deck: 'x', tags: tags.map(t => LEGACY_TAG_NAMES[t] ?? t), source_path: `x/${id}.md`, front: `Question ${id} ?`, back: `Réponse ${id}.`,
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
  // Registre des tags tiré du serveur : les 8 tags d'origine (vides compris).
  await db.tags.bulkPut(Object.values(LEGACY_TAG_NAMES).map((name, i) => ({ id: `t${i}`, name, updated_at: 'u' })))
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
    // #82 : titre selon l'entrée (« Révision du jour ») + « Carte 1 sur 3 » (taille de la file au démarrage).
    expect([...document.querySelectorAll('header p')].map(p => p.textContent)).toEqual(['Révision du jour', 'Carte 1 sur 3'])
    await rateAll(user)
    expect(await screen.findByText('Session terminée')).toBeTruthy()
    await waitFor(() => expect(runSync.mock.calls.length).toBeGreaterThanOrEqual(2)) // fin de session : notes poussées
    await user.click(screen.getByRole('button', { name: "Retour à l'accueil" }))
    await waitFor(() => expect(heading()).toBe("Aucune carte à revoir aujourd'hui"))
    expect(screen.getByRole('button', { name: 'Réviser à nouveau' })).toBeTruthy()
  })

  it('tap sur un tag (raccourci) : session limitée au tag, nom du tag dans la barre ; chevron → accueil', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Dev & outils, 2 cartes' }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    expect([...document.querySelectorAll('header p')].map(p => p.textContent)).toEqual(['Dev & outils', 'Carte 1 sur 2'])
    const seen = new Set<string>()
    while (screen.queryByRole('button', { name: 'Afficher la réponse' })) {
      seen.add(document.querySelector('article p.mt-3')!.textContent!)
      await user.click(screen.getByRole('button', { name: 'Afficher la réponse' }))
      await user.click(await screen.findByRole('button', { name: /Très bien/ }))
      await waitFor(() => expect(screen.queryByRole('button', { name: /Très bien/ })).toBeNull())
    }
    expect([...seen].sort()).toEqual(['Question b ?', 'Question c ?'])
    await user.click(within(document.querySelector('header')!).getByRole('button', { name: 'Accueil' }))
    await waitFor(() => expect(heading()).toBe("1 carte à revoir aujourd'hui")) // toutes les cartes : il reste 'a' (IA)
  })

  it('tags sans carte : absents de la rangée de raccourcis', async () => {
    renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    const row = screen.getByRole('list', { name: 'Réviser un tag' })
    expect(within(row).getAllByRole('button').map(b => b.textContent)).toEqual(['Dev & outils', 'IA & agents']) // même nombre de cartes : A–Z
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

  it('retour après une session terminée : pas de synchro en double, derniers compteurs affichés sans spinner', async () => {
    const { user, runSync } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    await rateAll(user)
    await screen.findByText('Session terminée')
    await waitFor(() => expect(runSync).toHaveBeenCalledTimes(2)) // montage + fin de session
    await user.click(screen.getByRole('button', { name: "Retour à l'accueil" }))
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy() // anciens chiffres, pas de spinner
    await waitFor(() => expect(heading()).toBe("Aucune carte à revoir aujourd'hui"))
    await new Promise(r => setTimeout(r, 50))
    expect(runSync).toHaveBeenCalledTimes(2)
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

describe('SignedInApp : badge de synchro (#22)', () => {
  const badge = () => screen.getByRole('status').textContent

  it('« Synchronisation… » pendant le sync, puis « Synchronisé »', async () => {
    let finish!: (v: typeof NOTHING) => void
    renderApp(vi.fn().mockReturnValueOnce(new Promise(r => { finish = r })).mockResolvedValue(NOTHING))
    await waitFor(() => expect(badge()).toBe('Synchronisation…'))
    finish(NOTHING)
    await waitFor(() => expect(badge()).toBe('Synchronisé'))
  })

  it('sync en échec : « Non synchronisé »', async () => {
    renderApp(vi.fn().mockRejectedValue(new Error('hors ligne')))
    await waitFor(() => expect(badge()).toBe('Non synchronisé'))
  })

  it('sync réussi mais une révision attend d’être envoyée : « Non synchronisé »', async () => {
    await db.reviews.add({ id: 'r1', card_id: 'a', rating: 3, reviewed_at: '2026-10-13T08:00:00.000Z', synced: 0 })
    const { runSync } = renderApp()
    await waitFor(() => expect(runSync).toHaveBeenCalled())
    await waitFor(() => expect(badge()).not.toBe('Synchronisation…'))
    expect(badge()).toBe('Non synchronisé')
  })
})

describe('SignedInApp : page Mes tags (#53)', () => {
  beforeEach(() => { window.history.replaceState(null, '') })

  it('accueil → Mes tags → session du tag → chevron « Mes tags » → chevron « Accueil »', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Mes tags, voir les 8 tags' }))
    await waitFor(() => expect(heading()).toBe('Mes tags'))
    expect(screen.getAllByRole('list').flatMap(l => within(l).getAllByRole('button'))).toHaveLength(8)
    await user.click(screen.getByRole('button', { name: /^Dev & outils, 2 cartes/ }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    expect(document.querySelector('header p')?.textContent).toBe('Dev & outils')
    await user.click(within(document.querySelector('header')!).getByRole('button', { name: 'Mes tags' }))
    await waitFor(() => expect(heading()).toBe('Mes tags'))
    await user.click(within(document.querySelector('header')!).getByRole('button', { name: 'Accueil' }))
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
  })

  it('fin d’une session ouverte depuis Mes tags : « Retour à l’accueil » ramène à l’accueil', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Mes tags, voir les 8 tags' }))
    await user.click(await screen.findByRole('button', { name: /^IA & agents, 2 cartes/ }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    await rateAll(user)
    await user.click(await screen.findByRole('button', { name: "Retour à l'accueil" }))
    await waitFor(() => expect(heading()).toBe("1 carte à revoir aujourd'hui"))
  })
})

describe('SignedInApp : retour avec « Modifier la carte » depuis le menu ⋯ (#88)', () => {
  const depth = () => (window.history.state as { vaultCardsDepth?: number } | null)?.vaultCardsDepth ?? 0
  const settle = () => act(() => new Promise(r => setTimeout(r, 50)))

  it('retour avec modification : confirmation, la révision reste ; « Ignorer » ferme le formulaire sans quitter la révision', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    expect(depth()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Actions de la carte' }))
    await user.click(screen.getByRole('menuitem', { name: 'Modifier' }))

    await user.type(screen.getByLabelText('QUESTION'), ' bis')
    act(() => { window.history.back() })
    await screen.findByRole('alertdialog')
    await settle()
    expect(heading()).toBe('Modifier la carte')
    expect(depth()).toBe(1)

    await user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect(heading()).toBe('Modifier la carte')

    act(() => { window.history.back() })
    await screen.findByRole('alertdialog')
    await settle()
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    expect(await screen.findByRole('button', { name: 'Afficher la réponse' })).toBeTruthy()
    expect(depth()).toBe(1)

    // Plus de saisie en cours : le retour redevient immédiat.
    act(() => { window.history.back() })
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await waitFor(() => expect(depth()).toBe(0))
  })
})

describe('SignedInApp : retour sans modification depuis « Modifier la carte » du menu ⋯ (#88)', () => {
  const depth = () => (window.history.state as { vaultCardsDepth?: number } | null)?.vaultCardsDepth ?? 0
  const settle = () => act(() => new Promise(r => setTimeout(r, 50)))

  it('ferme seulement le formulaire (la révision reste), comme le ✕ ; un second retour quitte la révision', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    await user.click(screen.getByRole('button', { name: 'Actions de la carte' }))
    await user.click(screen.getByRole('menuitem', { name: 'Modifier' }))
    expect(heading()).toBe('Modifier la carte')
    act(() => { window.history.back() })
    expect(await screen.findByRole('button', { name: 'Afficher la réponse' })).toBeTruthy()
    await settle()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(depth()).toBe(1)
    act(() => { window.history.back() })
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await waitFor(() => expect(depth()).toBe(0))
  })
})

describe('SignedInApp : barre commune (#82)', () => {
  it('Recherche et Profil sur l’accueil, Mes tags et la révision ; « Se déconnecter » dans Profil', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    const actions = () => within(document.querySelector('header')!).getAllByRole('button').map(b => b.getAttribute('aria-label'))
    expect(actions()).toEqual(['Rechercher', 'Profil'])
    await user.click(screen.getByRole('button', { name: 'Mes tags, voir les 8 tags' }))
    await waitFor(() => expect(heading()).toBe('Mes tags'))
    expect(actions()).toEqual(['Accueil', 'Rechercher', 'Profil'])
    await user.click(screen.getByRole('button', { name: /^Dev & outils, 2 cartes/ }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    expect(actions()).toEqual(['Mes tags', 'Rechercher', 'Profil'])
    await user.click(screen.getByRole('button', { name: 'Profil' }))
    expect(within(screen.getByRole('dialog', { name: 'Profil' })).getByRole('button', { name: 'Se déconnecter' })).toBeTruthy()
  })
})
