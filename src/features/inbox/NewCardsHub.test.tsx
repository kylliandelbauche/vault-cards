import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { VaultDB } from '../../lib/db'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import type { Card } from '../../lib/types'
import { SignedInApp } from '../home/SignedInApp'

const NOW = new Date(2026, 9, 19, 12, 0) // 19 octobre 2026, heure locale
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

let n = 0
const card = (over: Partial<Card> = {}): Card => ({
  id: `c${++n}`, source: 'manual', deck: null, source_path: null, tags: ['IA & agents'], front: `Question ${n} ?`, back: 'Réponse.',
  created_at: at(2026, 10, 5), updated_at: at(2026, 10, 5), deleted_at: null, ...over,
})
const generated = (inboxId: string, title: string, over: Partial<Card> = {}) =>
  card({ source: 'inbox', inbox_id: inboxId, source_title: title, created_at: at(2026, 10, 19, 10), ...over })

const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'i1', kind: 'text', filename: null, mime: null, size: null, status: 'pending', error: null,
  created_at: '2026-10-18T10:00:00Z', processed_at: null, ...over,
})

let db: VaultDB
beforeEach(() => {
  window.history.replaceState(null, '')
  db = new VaultDB(`hub-${crypto.randomUUID()}`)
})
afterEach(async () => { cleanup(); db.close(); await db.delete() })

function renderApp(created = item()) {
  const rpc = vi.fn().mockResolvedValue({ data: created, error: null })
  const upload = vi.fn().mockResolvedValue({ data: {}, error: null })
  const client = {
    rpc,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    storage: { from: () => ({ upload }) },
    from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }),
  }
  const inbox: InboxDeps = { client: client as unknown as InboxDeps['client'], online: () => true, uuid: () => 'i1' }
  const runSync = vi.fn().mockResolvedValue({ pushed: 0, pulledCards: 0, pulledReviews: 0 })
  render(<KApp theme="ios"><SignedInApp db={db} runSync={runSync} now={() => NOW} onSignOut={vi.fn()} inbox={inbox} /></KApp>)
  return { rpc, upload, user: userEvent.setup() }
}

const depth = () => (window.history.state as { vaultCardsDepth?: number } | null)?.vaultCardsDepth ?? 0
const title = () => screen.getByRole('heading', { level: 1 }).textContent
const openHub = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Toutes les sources' }))
  await screen.findByRole('heading', { level: 1, name: 'Nouvelles cartes' })
}

describe('Hub « Nouvelles cartes » (#86) : navigation', () => {
  it('le « › » du bloc de l’accueil ouvre le hub ; la flèche ramène à l’accueil', async () => {
    const { user } = renderApp()
    await openHub(user)
    expect(screen.getByText('Choisis comment créer')).toBeTruthy()
    expect(depth()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Nouvelles cartes' })).toBeTruthy()
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('le geste retour du navigateur ferme le hub', async () => {
    const { user } = renderApp()
    await openHub(user)
    act(() => { window.history.back() })
    expect(await screen.findByRole('heading', { level: 2, name: 'Nouvelles cartes' })).toBeTruthy()
    expect(screen.queryByText('Choisis comment créer')).toBeNull()
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('un écran ouvert depuis le hub y revient (retour = Nouvelles cartes)', async () => {
    const { user } = renderApp()
    await openHub(user)
    await user.click(screen.getByRole('button', { name: /^Texte/ }))
    expect(title()).toBe('Texte')
    expect(depth()).toBe(2)
    act(() => { window.history.back() })
    expect(await screen.findByText('Choisis comment créer')).toBeTruthy()
    await waitFor(() => expect(depth()).toBe(1))
  })
})

describe('Hub « Nouvelles cartes » (#86) : sources', () => {
  it('« À la main » pleine largeur, puis Fichier, Photo, Texte et Vocal en grille 2×2', async () => {
    const { user } = renderApp()
    await openHub(user)
    const sources = screen.getByRole('region', { name: 'Sources' })
    const names = within(sources).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.querySelector('span span')?.textContent)
    expect(names).toEqual(['À la main', 'Fichier', 'Photo', 'Texte', 'Vocal, bientôt disponible'])
    const manual = within(sources).getByRole('button', { name: /^À la main/ })
    expect(manual.parentElement?.className).not.toContain('grid')
    expect(within(sources).getByRole('button', { name: /^Fichier/ }).parentElement?.className).toContain('grid-cols-2')
  })

  it('À la main et Texte : mêmes écrans que sur l’accueil', async () => {
    const { user } = renderApp()
    await openHub(user)
    await user.click(screen.getByRole('button', { name: /^À la main/ }))
    expect(await screen.findByRole('heading', { name: 'Nouvelle carte' })).toBeTruthy()
    act(() => { window.history.back() })
    await screen.findByText('Choisis comment créer')
    await user.click(screen.getByRole('button', { name: /^Texte/ }))
    expect(title()).toBe('Texte')
  })

  it('Fichier et Photo : mêmes champs et même envoi que l’accueil, puis écran Brouillons ; retour = hub', async () => {
    const file = item({ kind: 'file', filename: 'cours.pdf' })
    const { user, upload, rpc } = renderApp(file)
    await openHub(user)
    expect(screen.getByLabelText('Prendre une photo').getAttribute('capture')).toBe('environment')
    expect(screen.getByLabelText('Choisir un fichier').getAttribute('accept')).toContain('.pdf')
    await user.upload(screen.getByLabelText('Choisir un fichier'), new File(['%PDF'], 'cours.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('Depuis « cours.pdf »')).toBeTruthy()
    expect(upload.mock.calls[0][0]).toBe('u1/i1')
    expect(rpc).toHaveBeenCalledWith('create_inbox_item', { p_id: 'i1', p_kind: 'file', p_filename: 'cours.pdf' })
    act(() => { window.history.back() })
    expect(await screen.findByText('Choisis comment créer')).toBeTruthy()
  })

  it('Vocal : grisé, indisponible (#48) ; un tap dit « bientôt » et n’envoie rien', async () => {
    const { user, rpc } = renderApp()
    await openHub(user)
    const voice = screen.getByRole('button', { name: 'Vocal, bientôt disponible' })
    expect(voice.getAttribute('aria-disabled')).toBe('true')
    expect(voice.className).toContain('tag-chip-empty')
    await user.click(voice)
    expect(screen.getByText('Le vocal arrive bientôt.').getAttribute('role')).toBe('status')
    expect(rpc).not.toHaveBeenCalled()
    expect(title()).toBe('Nouvelles cartes')
  })
})

describe('Hub « Nouvelles cartes » (#86) : Tes créations', () => {
  it('compteurs : brouillons, supprimées et cartes du vault exclus ; « ce mois-ci » selon le mois local', async () => {
    await db.cards.bulkPut([
      card({ created_at: at(2026, 10, 2) }),
      card({ created_at: at(2026, 9, 30, 23, 30) }),
      generated('i1', 'Cours.pdf'),
      generated('i1', 'Cours.pdf', { status: 'draft' }),
      card({ deleted_at: at(2026, 10, 6) }),
      card({ source: 'vault' }),
    ])
    const { user } = renderApp()
    await openHub(user)
    const created = (await screen.findByText('Cartes créées')).parentElement as HTMLElement
    expect(created.querySelector('dd')?.textContent).toBe('3')
    expect((screen.getByText('Ce mois-ci').parentElement as HTMLElement).querySelector('dd')?.textContent).toBe('2')
  })

  it('dernière génération : « il y a … », nom du document et nombre de cartes', async () => {
    await db.cards.bulkPut([
      generated('i1', 'Cours FSRS.pdf', { created_at: at(2026, 10, 19, 10) }),
      generated('i1', 'Cours FSRS.pdf', { created_at: at(2026, 10, 19, 10) }),
      generated('i0', 'Ancien.pdf', { created_at: at(2026, 10, 1) }),
    ])
    const { user } = renderApp()
    await openHub(user)
    expect(await screen.findByText('Dernière génération · il y a 2 h')).toBeTruthy()
    expect(screen.getByText('Cours FSRS.pdf · 2 cartes')).toBeTruthy()
  })

  it('avec des brouillons restants : ouvre les brouillons de ce document ; retour = hub', async () => {
    await db.cards.bulkPut([
      generated('i1', 'Cours FSRS.pdf', { status: 'draft', front: 'Brouillon A ?' }),
      generated('i1', 'Cours FSRS.pdf'),
      generated('i2', 'Autre.pdf', { status: 'draft', front: 'Brouillon étranger ?', created_at: at(2026, 10, 1) }),
    ])
    const { user } = renderApp()
    await openHub(user)
    const row = await screen.findByRole('button', { name: /Dernière génération/ })
    expect(row.textContent).toContain('1 brouillon à valider')
    await user.click(row)
    expect(await screen.findByText('Depuis « Cours FSRS.pdf »')).toBeTruthy()
    expect(screen.getByText('Brouillon A ?')).toBeTruthy()
    expect(screen.queryByText('Brouillon étranger ?')).toBeNull()
    act(() => { window.history.back() })
    expect(await screen.findByText('Choisis comment créer')).toBeTruthy()
  })

  it('sans brouillon : ouvre Mes cartes filtré sur ce document ; retour = hub', async () => {
    await db.cards.bulkPut([
      generated('i1', 'Cours FSRS.pdf', { front: 'Question FSRS ?' }),
      generated('i2', 'Autre.pdf', { front: 'Question étrangère ?', created_at: at(2026, 10, 1) }),
    ])
    const { user } = renderApp()
    await openHub(user)
    await user.click(await screen.findByRole('button', { name: /Dernière génération/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Mes cartes' })).toBeTruthy()
    const chip = await screen.findByRole('button', { name: 'Cours FSRS.pdf, 1 carte' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Question FSRS ?')).toBeTruthy()
    expect(screen.queryByText('Question étrangère ?')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Nouvelles cartes' }))
    expect(await screen.findByText('Choisis comment créer')).toBeTruthy()
  })

  it('aucune génération : état vide sobre, compteurs des cartes à la main', async () => {
    await db.cards.bulkPut([card({ created_at: at(2026, 10, 2) })])
    const { user } = renderApp()
    await openHub(user)
    expect(await screen.findByText(/Aucune génération pour l’instant/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Dernière génération/ })).toBeNull()
    expect((screen.getByText('Cartes créées').parentElement as HTMLElement).querySelector('dd')?.textContent).toBe('1')
  })
})
