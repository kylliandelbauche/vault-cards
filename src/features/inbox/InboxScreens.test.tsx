import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { VaultDB } from '../../lib/db'
import type { InboxDeps, InboxItem } from '../../lib/inbox'
import type { Card } from '../../lib/types'
import { SignedInApp } from '../home/SignedInApp'

const draft = (id: string, front: string, tags = ['ia']): Card => ({
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
    await db.cards.bulkPut([draft('a', 'Question A ?'), draft('bb', 'Question B ?', ['dev'])])
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
    await waitFor(() => expect(title()).toBe('Modifier la carte'))
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

    // Tags : 1 à 2 ; un 3e est bloqué.
    await user.click(screen.getByRole('button', { name: 'Dev & outils' }))
    expect(screen.getByRole('button', { name: 'Culture' }).getAttribute('aria-disabled')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByRole('button', { name: /^Nouvelle question \?/ })).toBeTruthy()
    const saved = await db.cards.get('a')
    expect(saved?.status).toBe('draft')
    expect(saved?.tags).toEqual(['ia', 'dev'])
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
})
