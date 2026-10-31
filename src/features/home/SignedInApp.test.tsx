import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { LEGACY_TAG_NAMES } from '../../../shared/tags'
import type { ProfileClient } from '../../lib/account'
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

// Profil (#83) : client d'authentification simulé (le bouton Profil de la barre en dépend ; l'écran est testé dans features/profile).
const profile = {
  client: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      updateUser: vi.fn(),
      signInWithPassword: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  } as unknown as ProfileClient,
}

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
  render(<KApp theme="ios"><SignedInApp db={db} runSync={runSync} now={now} onSignOut={vi.fn()} profile={profile} /></KApp>)
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
    expect(actions()).toEqual(['Mes tags', 'Profil']) // #80 : pas de loupe en révision
    // #83 : Profil est un écran (déconnexion comprise), posé sur la révision sans la remettre à zéro.
    await user.click(screen.getByRole('button', { name: 'Profil' }))
    expect(await screen.findByRole('button', { name: 'Se déconnecter' })).toBeTruthy()
    expect(heading()).toBe('Profil')
    await user.click(document.querySelector('header button') as HTMLElement)
    expect(await screen.findByRole('button', { name: 'Afficher la réponse' })).toBeTruthy()
    expect([...document.querySelectorAll('header p')].map(p => p.textContent)).toEqual(['Dev & outils', 'Carte 1 sur 2'])
  })
})

describe('SignedInApp : Profil sur la révision (#83)', () => {
  it('Profil › Cartes › retour › retour : la session de révision est conservée (carte courante, compteur)', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    await user.click(await screen.findByRole('button', { name: 'Afficher la réponse' }))
    await user.click(await screen.findByRole('button', { name: /Très bien/ }))
    await screen.findByText('Carte 2 sur 3')
    const question = document.querySelector('article p.mt-3')!.textContent
    await user.click(screen.getByRole('button', { name: 'Profil' }))
    await user.click(await screen.findByRole('button', { name: /Cartes/ }))
    await waitFor(() => expect(heading()).toBe('Mes cartes'))
    await user.click(document.querySelector('header button') as HTMLElement)
    await waitFor(() => expect(heading()).toBe('Profil'))
    await user.click(document.querySelector('header button') as HTMLElement)
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    expect(screen.getByText('Carte 2 sur 3')).toBeTruthy()
    expect(document.querySelector('article p.mt-3')!.textContent).toBe(question)
  })
})

describe('SignedInApp : Mes cartes (#80)', () => {
  const depth = () => (window.history.state as { vaultCardsDepth?: number } | null)?.vaultCardsDepth ?? 0
  const actions = () => within(document.querySelector('header')!).getAllByRole('button').map(b => b.getAttribute('aria-label'))

  it('la loupe de l’accueil ouvre Mes cartes (un niveau) ; flèche → accueil', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() => expect(heading()).toBe('Mes cartes'))
    expect(actions()).toEqual(['Accueil', 'Profil']) // pas de loupe sur Mes cartes
    expect(await screen.findByText('Question a ?')).toBeTruthy()
    expect(depth()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('révision en cours : pas de loupe (Mes cartes ne remet jamais la session à zéro)', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
    await user.click(await screen.findByRole('button', { name: 'Afficher la réponse' }))
    await user.click(await screen.findByRole('button', { name: /Très bien/ }))
    await screen.findByRole('button', { name: 'Afficher la réponse' })
    expect(screen.queryByRole('button', { name: 'Rechercher' })).toBeNull()
    expect(actions()).toEqual(['Accueil', 'Profil'])
    expect([...document.querySelectorAll('header p')].map(p => p.textContent)).toEqual(['Révision du jour', 'Carte 2 sur 3'])
  })

  it('geste retour / « précédent » du navigateur depuis Mes cartes : écran d’avant (Mes tags)', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Mes tags, voir les 8 tags' }))
    await waitFor(() => expect(heading()).toBe('Mes tags'))
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await waitFor(() => expect(heading()).toBe('Mes cartes'))
    expect(actions()).toEqual(['Mes tags', 'Profil'])
    await waitFor(() => expect(depth()).toBe(2))
    act(() => { window.history.back() })
    await waitFor(() => expect(heading()).toBe('Mes tags'))
    await waitFor(() => expect(depth()).toBe(1))
  })

  describe('« Étudier ces N cartes » (#105)', () => {
    const imported = (id: string): Card => ({
      id, source: 'inbox', inbox_id: 'doc1', status: 'active', deck: null, source_path: null, source_title: 'Cours FSRS.pdf', tags: ['FSRS'],
      front: `Question ${id} ?`, back: `Réponse ${id}.`, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', deleted_at: null,
    })
    const headerTexts = () => [...document.querySelectorAll('header p')].map(p => p.textContent)
    /** Mes cartes filtré sur le document, puis « Étudier ces 2 cartes ». */
    async function startStudy(user: ReturnType<typeof userEvent.setup>) {
      await db.cards.bulkPut([imported('i1'), imported('i2')])
      await waitFor(() => expect(heading()).toBe("5 cartes à revoir aujourd'hui"))
      await user.click(screen.getByRole('button', { name: 'Rechercher' }))
      await user.click(await screen.findByRole('button', { name: 'Cours FSRS.pdf, 2 cartes' }))
      await user.click(await screen.findByRole('button', { name: 'Étudier ces 2 cartes' }))
    }

    it('révision libre des seules cartes filtrées (notes free), « Réviser à nouveau » reste dans la liste, retour vers Mes cartes', async () => {
      const { user } = renderApp()
      await startStudy(user)
      expect(await screen.findByRole('button', { name: 'Afficher la réponse' })).toBeTruthy()
      expect(headerTexts()).toEqual(['Cartes filtrées', 'Carte 1 sur 2']) // pas « Révision du jour »
      expect(depth()).toBe(2)
      await rateAll(user)
      expect(await screen.findByText('Session terminée')).toBeTruthy()
      expect((await db.reviews.toArray()).map(r => [r.card_id, r.free]).sort()).toEqual([['i1', true], ['i2', true]])
      await user.click(screen.getByRole('button', { name: 'Réviser à nouveau' }))
      expect(await screen.findByText('Carte 1 sur 2')).toBeTruthy() // 2 cartes, pas les 5 du paquet
      // Flèche : Mes cartes, nommée d'après sa destination ; un second retour mène à l'accueil.
      await user.click(screen.getByRole('button', { name: 'Mes cartes' }))
      await waitFor(() => expect(heading()).toBe('Mes cartes'))
      expect(await screen.findByText('Question i1 ?')).toBeTruthy()
      await waitFor(() => expect(depth()).toBe(1))
      await user.click(screen.getByRole('button', { name: 'Accueil' }))
      await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui")) // les 2 étudiées sont passées, les 3 du vault restent
    })

    it('geste retour / « précédent » du navigateur pendant l’étude : Mes cartes', async () => {
      const { user } = renderApp()
      await startStudy(user)
      await screen.findByRole('button', { name: 'Afficher la réponse' })
      act(() => { window.history.back() })
      await waitFor(() => expect(heading()).toBe('Mes cartes'))
      await waitFor(() => expect(depth()).toBe(1))
    })

    it('lancée depuis Mes cartes posé sur une révision (Profil › Cartes) : la nouvelle liste s’applique, le retour retrouve la révision', async () => {
      const { user } = renderApp()
      await db.cards.bulkPut([imported('i1'), imported('i2')])
      await waitFor(() => expect(heading()).toBe("5 cartes à revoir aujourd'hui"))
      await user.click(screen.getByRole('button', { name: 'Commencer à étudier' }))
      await screen.findByText('Carte 1 sur 5')
      await user.click(screen.getByRole('button', { name: 'Profil' }))
      await user.click(await screen.findByRole('button', { name: /Cartes/ }))
      await user.click(await screen.findByRole('button', { name: 'Cours FSRS.pdf, 2 cartes' }))
      await user.click(await screen.findByRole('button', { name: 'Étudier ces 2 cartes' }))
      expect(await screen.findByText('Carte 1 sur 2')).toBeTruthy()
      expect(headerTexts()[0]).toBe('Cartes filtrées')
      await user.click(screen.getByRole('button', { name: 'Mes cartes' }))
      await waitFor(() => expect(heading()).toBe('Mes cartes'))
    })
  })

  it('modifier une carte depuis Mes cartes : le retour iOS ferme le formulaire et reste sur Mes cartes', async () => {
    const { user } = renderApp()
    await waitFor(() => expect(heading()).toBe("3 cartes à revoir aujourd'hui"))
    await user.click(screen.getByRole('button', { name: 'Rechercher' }))
    await user.click(await screen.findByText('Question b ?'))
    expect(await screen.findByRole('heading', { name: 'Modifier la carte' })).toBeTruthy()
    act(() => { window.history.back() })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Modifier la carte' })).toBeNull())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mes cartes')
    await waitFor(() => expect(depth()).toBe(1))
  })
})
