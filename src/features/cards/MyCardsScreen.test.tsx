import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { VaultDB } from '../../lib/db'
import type { Card } from '../../lib/types'
import { MyCardsScreen } from './MyCardsScreen'

const base = { deck: null, source_path: null, source_title: null, updated_at: '2026-10-01T00:00:00Z', deleted_at: null } as const
const CARDS: Card[] = [
  { ...base, id: 'v1', source: 'vault', deck: 'x', source_path: 'x/a.md', source_title: 'Note', front: 'Qu’est-ce que la répétition espacée ?', back: 'Revoir avant d’oublier.', tags: ['Mémoire'], created_at: '2026-10-01T00:00:00Z' },
  { ...base, id: 'm1', source: 'manual', front: 'Que garantit la RLS ?', back: 'Ses propres lignes.', tags: ['Sécurité'], created_at: '2026-10-02T00:00:00Z' },
  { ...base, id: 'i1', source: 'inbox', inbox_id: 'pdf', status: 'active', source_title: 'Cours FSRS.pdf', front: 'Que mesure la stabilité ?', back: 'Jours avant 90 %.', tags: ['FSRS'], created_at: '2026-10-03T00:00:00Z' },
  { ...base, id: 'i2', source: 'inbox', inbox_id: 'pdf', status: 'active', source_title: 'Cours FSRS.pdf', front: 'Trois valeurs de FSRS ?', back: 'Stabilité, difficulté, récupérabilité.', tags: ['FSRS', 'Algorithmes'], created_at: '2026-10-04T00:00:00Z' },
  { ...base, id: 'i3', source: 'inbox', inbox_id: 'photo', status: 'active', source_title: 'Photo du 18/10', front: 'Quand une carte est-elle maîtrisée ?', back: 'Stabilité > 21 jours.', tags: ['FSRS'], created_at: '2026-10-05T00:00:00Z' },
  // Exclues : brouillon et carte supprimée.
  { ...base, id: 'd1', source: 'inbox', inbox_id: 'vocal', status: 'draft', source_title: 'Vocal du 12/10', front: 'Brouillon ?', back: 'Pas encore accepté.', tags: ['FSRS'], created_at: '2026-10-06T00:00:00Z' },
  { ...base, id: 'x1', source: 'manual', front: 'Supprimée ?', back: 'Oui.', tags: ['Vieux'], deleted_at: '2026-10-07T00:00:00Z', created_at: '2026-10-07T00:00:00Z' },
]

let db: VaultDB
beforeEach(async () => {
  db = new VaultDB(`mycards-${crypto.randomUUID()}`)
  await db.cards.bulkPut(CARDS)
})
afterEach(async () => { cleanup(); db.close(); await db.delete() })

function renderScreen() {
  const onBack = vi.fn()
  const onWrite = vi.fn()
  render(<KApp theme="ios"><MyCardsScreen db={db} onBack={onBack} onWrite={onWrite} /></KApp>)
  return { onBack, onWrite, user: userEvent.setup() }
}
const list = () => screen.getByRole('list', { name: 'Cartes' })
const fronts = () => within(list()).getAllByRole('listitem').map(li => li.querySelector('span')!.textContent)
const subtitle = () => document.querySelector('header h1')!.nextElementSibling!.textContent
const search = () => screen.getByRole('searchbox', { name: 'Rechercher dans mes cartes' })
const row = (front: string) => within(list()).getByText(front).closest('li')!

describe('MyCardsScreen (#80)', () => {
  it('titre, nombre de cartes, sans loupe ; cartes actives avec leurs tags, ni brouillons ni supprimées', async () => {
    renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mes cartes')
    expect(subtitle()).toBe('5 cartes')
    expect(screen.queryByRole('button', { name: 'Rechercher' })).toBeNull()
    expect(fronts()[0]).toBe('Quand une carte est-elle maîtrisée ?') // la plus récente d'abord
    expect(screen.queryByText('Brouillon ?')).toBeNull()
    expect(screen.queryByText('Supprimée ?')).toBeNull()
    expect(within(row('Trois valeurs de FSRS ?')).getByText('Algorithmes').className).toContain('tag-pill')
    expect(search().getAttribute('placeholder')).toBe('Question, réponse, tag ou document')
  })

  it('rangée « Tous » + documents importés (cartes inbox actives seulement) ; filtre par document', async () => {
    const { user } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const docs = screen.getByRole('list', { name: 'Filtrer par document' })
    const chips = within(docs).getAllByRole('button')
    expect(chips.map(b => b.textContent)).toEqual(['Tous', 'Photo du 18/10', 'Cours FSRS.pdf']) // ni vault, ni manual, ni brouillons
    expect(chips[0].getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Cours FSRS.pdf, 2 cartes' }))
    expect(screen.getByRole('button', { name: 'Cours FSRS.pdf, 2 cartes' }).getAttribute('aria-pressed')).toBe('true')
    expect(fronts()).toEqual(['Trois valeurs de FSRS ?', 'Que mesure la stabilité ?'])
    expect(subtitle()).toBe('2 cartes')
    await user.click(screen.getByRole('button', { name: 'Tous' }))
    expect(fronts()).toHaveLength(5)
  })

  it('recherche locale sans accents ni casse, sur question, réponse, tag et document, combinée au document', async () => {
    const { user } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    await user.type(search(), 'STABILITE')
    await waitFor(() => expect(fronts()).toEqual(['Quand une carte est-elle maîtrisée ?', 'Trois valeurs de FSRS ?', 'Que mesure la stabilité ?']))
    await user.click(screen.getByRole('button', { name: 'Cours FSRS.pdf, 2 cartes' }))
    expect(fronts()).toEqual(['Trois valeurs de FSRS ?', 'Que mesure la stabilité ?'])
    await user.clear(search())
    await user.type(search(), 'sécurite')
    await waitFor(() => expect(screen.getByText('Aucune carte ne correspond à ta recherche.')).toBeTruthy()) // RLS n'est pas dans le PDF
    await user.click(screen.getByRole('button', { name: 'Tous' }))
    await waitFor(() => expect(fronts()).toEqual(['Que garantit la RLS ?'])) // par son tag
    await user.clear(search())
    await user.type(search(), 'photo du')
    await waitFor(() => expect(fronts()).toEqual(['Quand une carte est-elle maîtrisée ?'])) // par le nom du document
  })

  it('tap sur une carte → « Modifier la carte » (formulaire #73) ; enregistrer met la liste à jour et synchronise', async () => {
    const { user, onWrite } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    await user.click(within(list()).getByText('Que garantit la RLS ?'))
    expect(await screen.findByRole('heading', { name: 'Modifier la carte' })).toBeTruthy()
    const front = screen.getByLabelText('QUESTION')
    expect((front as HTMLTextAreaElement).value).toBe('Que garantit la RLS ?')
    await user.clear(front)
    await user.type(front, 'Que garantit la RLS sur une table ?')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Modifier la carte' })).toBeNull())
    await waitFor(() => expect(fronts()).toContain('Que garantit la RLS sur une table ?'))
    expect((await db.cards.get('m1'))?.front).toBe('Que garantit la RLS sur une table ?')
    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  it('glisser une carte vers la gauche → « Supprimer » → confirmation → suppression douce', async () => {
    const { user, onWrite } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const li = row('Que garantit la RLS ?')
    const face = li.querySelector('.list-card')!
    expect(within(li).queryByRole('button', { name: 'Supprimer' })).toBeNull()
    const touch = { pointerId: 7, pointerType: 'touch', isPrimary: true }
    fireEvent.pointerDown(face, { ...touch, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(face, { ...touch, clientX: 280, clientY: 102 })
    fireEvent.pointerMove(face, { ...touch, clientX: 190, clientY: 103 })
    fireEvent.pointerUp(face, { ...touch, clientX: 190, clientY: 103 })
    const reveal = await within(li).findByRole('button', { name: 'Supprimer' })
    await user.click(reveal)
    const dialog = screen.getByRole('alertdialog', { name: 'Cette carte disparaîtra de tes révisions.' })
    await user.click(within(dialog).getByRole('button', { name: 'Supprimer la carte' }))
    await waitFor(() => expect(fronts()).toHaveLength(4))
    expect(screen.queryByText('Que garantit la RLS ?')).toBeNull()
    const stored = await db.cards.get('m1')
    expect(stored?.deleted_at).not.toBeNull()
    expect(stored?.synced).toBe(0)
    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  it('glissement vertical : défilement, la carte ne s’ouvre pas ; tap après un glissement court : rien', async () => {
    renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const li = row('Que garantit la RLS ?')
    const face = li.querySelector('.list-card')!
    const touch = { pointerId: 3, pointerType: 'touch', isPrimary: true }
    fireEvent.pointerDown(face, { ...touch, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(face, { ...touch, clientX: 296, clientY: 160 })
    fireEvent.pointerMove(face, { ...touch, clientX: 200, clientY: 170 })
    fireEvent.pointerCancel(face, touch)
    expect(within(li).queryByRole('button', { name: 'Supprimer' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Modifier la carte' })).toBeNull()
  })

  it('Mac : corbeille (survol / focus) → confirmation ; Annuler garde la carte', async () => {
    const { user, onWrite } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const trash = within(row('Que mesure la stabilité ?')).getByRole('button', { name: 'Supprimer la carte' })
    expect(trash.className.split(' ')).toEqual(expect.arrayContaining(['size-11', 'pointer-fine:flex', 'group-hover:opacity-100', 'focus-visible:opacity-100']))
    await user.click(trash)
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(fronts()).toHaveLength(5)
    expect((await db.cards.get('i1'))?.deleted_at).toBeNull()
    expect(onWrite).not.toHaveBeenCalled()
  })

  it('flèche retour : onBack', async () => {
    const { user, onBack } = renderScreen()
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
