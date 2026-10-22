import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { LEGACY_TAG_NAMES } from '../../../shared/tags'
import { VaultDB } from '../../lib/db'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import type { Card } from '../../lib/types'
import { SignedInApp } from '../home/SignedInApp'

const draft = (id: string, front: string, tags = ['IA & agents']): Card => ({
  id, source: 'inbox', deck: null, source_path: null, tags, front, back: `Réponse ${id}.`, inbox_id: 'i1',
  status: 'draft', created_at: `2026-10-18T10:00:0${id.length}Z`, updated_at: '2026-10-18T10:00:00Z', deleted_at: null,
})
const item = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'i1', kind: 'text', filename: null, mime: null, size: null, status: 'pending', error: null,
  created_at: '2026-10-18T10:00:00Z', processed_at: null, ...over,
})

let db: VaultDB
beforeEach(() => {
  window.history.replaceState(null, '')
  db = new VaultDB(`inbox-ui-${crypto.randomUUID()}`)
  // Registre des tags tiré du serveur (#79) : les 8 tags d'origine.
  void db.tags.bulkPut(Object.values(LEGACY_TAG_NAMES).map((name, i) => ({ id: `t${i}`, name, updated_at: 'u' })))
})
afterEach(async () => { cleanup(); db.close(); await db.delete() })

/** Faux client Supabase : RPC create_inbox_item, envoi Storage, lecture des statuts. */
function fakeClient(items: InboxItem[], created: InboxItem) {
  const rpc = vi.fn().mockResolvedValue({ data: created, error: null })
  const upload = vi.fn().mockResolvedValue({ data: {}, error: null })
  const client = {
    rpc,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    storage: { from: () => ({ upload }) },
    from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: items, error: null }) }) }) }),
  }
  return { rpc, upload, client: client as unknown as InboxDeps['client'] }
}

const NOTHING = { pushed: 0, pulledCards: 0, pulledReviews: 0 }

function renderApp({ items = [item()], created = item(), online = true, runSync = vi.fn().mockResolvedValue(NOTHING) } = {}) {
  const fake = fakeClient(items, created)
  const inbox: InboxDeps = { client: fake.client, online: () => online, uuid: () => 'i1' }
  render(<KApp theme="ios"><SignedInApp db={db} runSync={runSync} now={() => new Date('2026-10-19T10:00:00Z')} onSignOut={vi.fn()} inbox={inbox} /></KApp>)
  return { ...fake, runSync, user: userEvent.setup() }
}

const title = () => screen.getByRole('heading', { level: 1 }).textContent

describe('Boîte de réception : écrans (#81)', () => {
  it('Texte → Source · Texte → envoi → Brouillons en attente ; « précédent » revient à l’accueil', async () => {
    const { user, rpc } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Texte' }))
    expect(title()).toBe('Texte')
    const send = screen.getByRole('button', { name: 'Créer les brouillons' }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    await user.type(screen.getByLabelText('Texte dont tirer des cartes'), 'La répétition espacée.')
    expect(screen.getByText('22 caractères')).toBeTruthy()
    await user.click(send)
    expect(rpc).toHaveBeenCalledWith('create_inbox_item', { p_id: 'i1', p_kind: 'text', p_text: 'La répétition espacée.' })
    expect(await screen.findByText('En attente de traitement sur ton Mac')).toBeTruthy()
    expect(await screen.findByText('En file d’attente.')).toBeTruthy()
    expect(screen.getByText('Depuis « Texte collé »')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
  })

  it('hors ligne : message clair, rien n’est envoyé', async () => {
    const { user, rpc } = renderApp({ online: false })
    await user.click(await screen.findByRole('button', { name: 'Texte' }))
    await user.type(screen.getByLabelText('Texte dont tirer des cartes'), 'Bonjour')
    await user.click(screen.getByRole('button', { name: 'Créer les brouillons' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Pas de connexion/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('Source · Texte : ✕ avec du texte demande confirmation ; « Ignorer » ferme', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Texte' }))
    await user.type(screen.getByLabelText('Texte dont tirer des cartes'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.getByRole('alertdialog').textContent).toMatch('Tes modifications ne seront pas enregistrées.')
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
  })

  it('Fichier puis Photo : envoi direct puis écran Brouillons de la source', async () => {
    const file = item({ kind: 'file', filename: 'cours.pdf' })
    const { user, upload, rpc } = renderApp({ items: [file], created: file })
    await screen.findByRole('heading', { name: 'Nouvelles cartes' })
    await user.upload(screen.getByLabelText('Choisir un fichier'), new File(['%PDF'], 'cours.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText('Depuis « cours.pdf »')).toBeTruthy()
    expect(upload.mock.calls[0][0]).toBe('u1/i1')
    expect(rpc).toHaveBeenCalledWith('create_inbox_item', { p_id: 'i1', p_kind: 'file', p_filename: 'cours.pdf' })
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    await user.upload(await screen.findByLabelText('Prendre une photo'), new File(['jpg'], 'image.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('En attente de traitement sur ton Mac')).toBeTruthy()
  })

  it('Vocal : message « bientôt », aucun envoi', async () => {
    const { user, rpc } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Vocal, bientôt disponible' }))
    expect(screen.getByText('Le vocal arrive bientôt.').getAttribute('role')).toBe('status')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('brouillons : accès depuis l’accueil, × retire, « Tout valider » active et revient à l’accueil', async () => {
    await db.cards.bulkPut([draft('a', 'Question A ?'), draft('bb', 'Question B ?', ['Dev & outils'])])
    const { user } = renderApp({ items: [item({ status: 'done' })] })
    await user.click(await screen.findByRole('button', { name: '2 brouillons à valider' }))
    await waitFor(() => expect(title()).toBe('2 brouillons'))
    expect(screen.getByText('IA & agents')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retirer « Question A ? »' }))
    await waitFor(() => expect(title()).toBe('1 brouillon'))
    expect((await db.cards.get('a'))?.deleted_at).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Tout valider (1 carte)' }))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
    expect((await db.cards.get('bb'))?.status).toBe('active')
    expect(screen.queryByRole('button', { name: /brouillons? à valider/ })).toBeNull()
  })

  it('Modifier la carte : ✕ sans modification ferme ; avec, confirmation ; ✓ enregistre sans valider', async () => {
    await db.cards.put(draft('a', 'Question A ?'))
    const { user } = renderApp({ items: [item({ status: 'done' })] })
    await user.click(await screen.findByRole('button', { name: '1 brouillon à valider' }))
    await user.click(await screen.findByRole('button', { name: /^Question A \?/ }))
    await screen.findByLabelText('QUESTION') // formulaire chargé (pas l’écran d’attente)
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    await waitFor(() => expect(title()).toBe('1 brouillon'))

    await user.click(await screen.findByRole('button', { name: /^Question A \?/ }))
    const question = await screen.findByLabelText('QUESTION')
    await user.clear(question)
    await user.type(question, 'Nouvelle question ?')
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    await user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect((screen.getByLabelText('QUESTION') as HTMLTextAreaElement).value).toBe('Nouvelle question ?')

    // Tags libres (#79) : « Ajouter un tag » → écran « Ajouter des tags » ; un tag existant ajouté, un nouveau créé.
    await user.click(screen.getByRole('button', { name: 'Ajouter un tag' }))
    expect(title()).toBe('Ajouter des tags')
    await user.click(await screen.findByRole('button', { name: /^Dev & outils/ }))
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher ou créer un tag' }), 'Mémoire')
    await user.click(screen.getByRole('button', { name: 'Créer « Mémoire »' }))
    await user.click(screen.getByRole('button', { name: 'Valider les tags' }))
    expect(title()).toBe('Modifier la carte')
    expect(screen.getByRole('button', { name: 'Retirer Mémoire' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retirer IA & agents' }))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('button', { name: /^Nouvelle question \?/ })).toBeTruthy()
    const saved = await db.cards.get('a')
    expect(saved?.status).toBe('draft')
    expect(saved?.tags).toEqual(['Mémoire', 'Dev & outils'])
    // Brouillon : le nouveau nom reste sur la carte, aucun tag créé (seulement à la validation, côté serveur).
    expect((await db.tags.toArray()).map(t => t.name)).not.toContain('Mémoire')
  })

  it('Modifier la carte : ✓ refuse une question vide (message clair, reste sur l’écran)', async () => {
    await db.cards.put(draft('a', 'Question A ?'))
    const { user } = renderApp({ items: [item({ status: 'done' })] })
    await user.click(await screen.findByRole('button', { name: '1 brouillon à valider' }))
    await user.click(await screen.findByRole('button', { name: /^Question A \?/ }))
    await user.clear(await screen.findByLabelText('QUESTION'))
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Question : /)
    expect(title()).toBe('Modifier la carte')
  })

  it('source traitée, rien en local : « Récupération des brouillons… » + Réessayer tant qu’aucune synchro n’a réussi', async () => {
    const runSync = vi.fn().mockRejectedValue(new Error('hors ligne'))
    const file = item({ kind: 'file', filename: 'cours.pdf', status: 'done' })
    const { user } = renderApp({ items: [file], created: file, runSync })
    await screen.findByRole('heading', { name: 'Nouvelles cartes' })
    await user.upload(screen.getByLabelText('Choisir un fichier'), new File(['%PDF'], 'cours.pdf', { type: 'application/pdf' }))
    expect(await screen.findByRole('heading', { name: 'Récupération des brouillons…' })).toBeTruthy()
    const retry = await screen.findByRole('button', { name: 'Réessayer' })
    expect(screen.queryByText(/aucun brouillon/i)).toBeNull()
    runSync.mockResolvedValue(NOTHING)
    await user.click(retry)
    expect(await screen.findByText('Traitée : aucun brouillon à valider.')).toBeTruthy()
  })

  it('Accueil v4 : rangée de 5 tuiles ; Photo = appareil photo, Fichier = formats acceptés', async () => {
    renderApp()
    const row = await screen.findByRole('list', { name: 'Ajouter des cartes' })
    expect([...row.querySelectorAll('li')].map(li => li.textContent)).toEqual(['À la main', 'Fichier', 'Photo', 'Texte', 'Vocal'])
    const photo = screen.getByLabelText('Prendre une photo')
    expect(photo.getAttribute('accept')).toBe('image/*')
    expect(photo.getAttribute('capture')).toBe('environment')
    expect(screen.getByLabelText('Choisir un fichier').getAttribute('accept')).toContain('.pdf')
  })

  it('À la main → Nouvelle carte : ✓ désactivé tant que question ou réponse vide ; ✓ crée la carte et revient à l’accueil', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'À la main' }))
    expect(title()).toBe('Nouvelle carte')
    const create = screen.getByRole('button', { name: 'Créer la carte' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    await user.type(screen.getByLabelText('QUESTION'), 'Qu’est-ce que FSRS ?')
    expect(create.disabled).toBe(true)
    await user.type(screen.getByLabelText('RÉPONSE'), 'Un algorithme de répétition espacée.')
    expect(create.disabled).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Ajouter un tag' }))
    await user.click(await screen.findByRole('button', { name: /^Mental & psycho/ }))
    await user.click(screen.getByRole('button', { name: 'Valider les tags' }))
    expect((screen.getByLabelText('QUESTION') as HTMLTextAreaElement).value).toBe('Qu’est-ce que FSRS ?') // saisie conservée
    await user.click(screen.getByRole('button', { name: 'Créer la carte' }))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
    const manual = await db.cards.filter(c => c.source === 'manual').toArray()
    expect(manual.map(c => [c.front, c.back, c.tags])).toEqual([['Qu’est-ce que FSRS ?', 'Un algorithme de répétition espacée.', ['Mental & psycho']]])
  })

  it('Nouvelle carte : ✕ sans saisie ferme ; avec saisie, confirmation (Échap = continuer)', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'À la main' }))
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    await user.click(await screen.findByRole('button', { name: 'À la main' }))
    await user.type(screen.getByLabelText('QUESTION'), 'a')
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(title()).toBe('Nouvelle carte')
    expect(await db.cards.count()).toBe(0)
  })

  it('Source · Texte : au-delà de 100 000 caractères, compteur en alerte et envoi désactivé', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Texte' }))
    await user.click(screen.getByLabelText('Texte dont tirer des cartes'))
    await user.paste('a'.repeat(100_001))
    expect(screen.getByText(/100001 caractères : 100\u202f000 au maximum|100001 caractères : 100.000 au maximum/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Créer les brouillons' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Modifier la carte : ✓ sans modification ferme sans rien écrire', async () => {
    await db.cards.put(draft('a', 'Question A ?'))
    const { user } = renderApp({ items: [item({ status: 'done' })] })
    await user.click(await screen.findByRole('button', { name: '1 brouillon à valider' }))
    await user.click(await screen.findByRole('button', { name: /^Question A \?/ }))
    await screen.findByLabelText('QUESTION')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(title()).toBe('1 brouillon'))
    const card = await db.cards.get('a')
    expect(card?.updated_at).toBe('2026-10-18T10:00:00Z')
    expect(card?.synced).toBeUndefined()
  })
})

describe('Retour du navigateur / geste iOS avec saisie non enregistrée (#88)', () => {
  const depth = () => (window.history.state as { vaultCardsDepth?: number } | null)?.vaultCardsDepth ?? 0
  const settle = () => act(() => new Promise(r => setTimeout(r, 50)))
  const goBack = () => { act(() => { window.history.back() }) }

  it('Source · Texte sans saisie : le retour ferme tout de suite', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Texte' }))
    expect(depth()).toBe(1)
    goBack()
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('Source · Texte avec saisie : le retour ouvre la confirmation et l’écran reste ; « Continuer » garde la saisie', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Texte' }))
    await user.type(screen.getByLabelText('Texte dont tirer des cartes'), 'abc')
    goBack()
    expect((await screen.findByRole('alertdialog')).textContent).toMatch('Tes modifications ne seront pas enregistrées.')
    await settle()
    expect(title()).toBe('Texte')
    expect(depth()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(title()).toBe('Texte')
    expect((screen.getByLabelText('Texte dont tirer des cartes') as HTMLTextAreaElement).value).toBe('abc')
  })

  it('Source · Texte : deux retours d’affilée puis « Ignorer » → accueil, historique à la profondeur 0', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'Texte' }))
    await user.type(screen.getByLabelText('Texte dont tirer des cartes'), 'abc')
    goBack()
    await screen.findByRole('alertdialog')
    await settle()
    goBack()
    await settle()
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    expect(title()).toBe('Texte')
    expect(depth()).toBe(1)
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
    await waitFor(() => expect(depth()).toBe(0))
    await settle()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('Nouvelle carte : sans saisie, le retour ferme ; avec saisie, confirmation puis « Ignorer »', async () => {
    const { user } = renderApp()
    await user.click(await screen.findByRole('button', { name: 'À la main' }))
    goBack()
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
    await waitFor(() => expect(depth()).toBe(0))

    await user.click(await screen.findByRole('button', { name: 'À la main' }))
    await user.type(screen.getByLabelText('QUESTION'), 'a')
    goBack()
    await screen.findByRole('alertdialog')
    await settle()
    expect(title()).toBe('Nouvelle carte')
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    expect(await screen.findByRole('heading', { name: 'Nouvelles cartes' })).toBeTruthy()
    await waitFor(() => expect(depth()).toBe(0))
    expect(await db.cards.count()).toBe(0)
  })

  it('Modifier la carte (brouillon) : retour avec modification → confirmation ; « Ignorer » revient aux Brouillons, une pile en moins', async () => {
    await db.cards.put(draft('a', 'Question A ?'))
    const { user } = renderApp({ items: [item({ status: 'done' })] })
    await user.click(await screen.findByRole('button', { name: '1 brouillon à valider' }))
    await user.click(await screen.findByRole('button', { name: /^Question A \?/ }))
    await screen.findByLabelText('QUESTION')
    expect(depth()).toBe(2)
    goBack() // sans modification : retour immédiat aux Brouillons
    await waitFor(() => expect(title()).toBe('1 brouillon'))
    await waitFor(() => expect(depth()).toBe(1))

    await user.click(await screen.findByRole('button', { name: /^Question A \?/ }))
    await user.type(await screen.findByLabelText('QUESTION'), ' bis')
    goBack()
    await screen.findByRole('alertdialog')
    await settle()
    expect(title()).toBe('Modifier la carte')
    expect(depth()).toBe(2)
    await user.click(screen.getByRole('button', { name: 'Ignorer les modifications' }))
    await waitFor(() => expect(title()).toBe('1 brouillon'))
    await waitFor(() => expect(depth()).toBe(1))
    expect((await db.cards.get('a'))?.front).toBe('Question A ?')
  })

  it('un retour de l’app (✓ Enregistrer, ✕ sans modification) n’ouvre jamais la confirmation', async () => {
    await db.cards.put(draft('a', 'Question A ?'))
    const { user } = renderApp({ items: [item({ status: 'done' })] })
    await user.click(await screen.findByRole('button', { name: '1 brouillon à valider' }))
    await user.click(await screen.findByRole('button', { name: /^Question A \?/ }))
    await user.type(await screen.findByLabelText('QUESTION'), ' bis')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(title()).toBe('1 brouillon'))
    await settle()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(depth()).toBe(1))
  })
})
