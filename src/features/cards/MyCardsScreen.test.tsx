import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

function renderScreen(initialDocumentId?: string) {
  const onBack = vi.fn()
  const onWrite = vi.fn()
  render(<KApp theme="ios"><MyCardsScreen db={db} initialDocumentId={initialDocumentId} onBack={onBack} onWrite={onWrite} /></KApp>)
  return { onBack, onWrite, user: userEvent.setup() }
}
const list = () => screen.getByRole('list', { name: 'Cartes' })
const fronts = () => within(list()).getAllByRole('listitem').map(li => li.querySelector('span')!.textContent)
const subtitle = () => document.querySelector('header h1')!.nextElementSibling!.textContent
const search = () => screen.getByRole('searchbox', { name: 'Rechercher dans mes cartes' })
const row = (front: string) => within(list()).getByText(front).closest('li')!
const face = (li: HTMLElement) => li.querySelector<HTMLElement>('.list-card')!
const deleteAction = (li: HTMLElement) => li.querySelector<HTMLButtonElement>('.delete-action')
const TOUCH = { pointerId: 7, pointerType: 'touch', isPrimary: true }
/** Glissement horizontal au doigt depuis x = 300 jusqu'aux positions données, puis relâché. */
function swipe(el: HTMLElement, xs: number[], pointer: object = TOUCH) {
  fireEvent.pointerDown(el, { ...pointer, clientX: 300, clientY: 100 })
  for (const x of xs) fireEvent.pointerMove(el, { ...pointer, clientX: x, clientY: 101 })
  fireEvent.pointerUp(el, { ...pointer, clientX: xs.at(-1), clientY: 101 })
}

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
    expect(deleteAction(li)).toBeNull()
    swipe(face(li), [280, 190])
    expect(face(li).style.transform).toBe('translate3d(-92px,0,0)')
    const reveal = deleteAction(li)!
    expect(reveal.style.clipPath).toBe('inset(0 0 0 0px round 22px)') // entièrement dégagé
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

  it('pendant le glissement, « Supprimer » n’est visible que dans la place libérée par la carte (jamais au travers)', async () => {
    renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const li = row('Que garantit la RLS ?')
    const f = face(li)
    fireEvent.pointerDown(f, { ...TOUCH, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(f, { ...TOUCH, clientX: 280, clientY: 101 }) // axe horizontal choisi : bouton monté
    fireEvent.pointerMove(f, { ...TOUCH, clientX: 270, clientY: 101 })
    expect(f.style.transform).toBe('translate3d(-30px,0,0)')
    expect(deleteAction(li)!.style.clipPath).toBe('inset(0 0 0 50px round 22px)') // 30 px de droite seulement
    fireEvent.pointerUp(f, { ...TOUCH, clientX: 270, clientY: 101 }) // avant la moitié : se referme
    expect(f.style.transform).toBe('')
    expect(deleteAction(li)).toBeNull()
  })

  it('glissement vertical : défilement, rien ne s’ouvre même si le doigt part ensuite à l’horizontale', async () => {
    renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const li = row('Que garantit la RLS ?')
    const f = face(li)
    fireEvent.pointerDown(f, { ...TOUCH, clientX: 300, clientY: 100 })
    fireEvent.pointerMove(f, { ...TOUCH, clientX: 296, clientY: 160 }) // vertical : laissé au navigateur
    fireEvent.pointerMove(f, { ...TOUCH, clientX: 150, clientY: 165 })
    expect(f.style.transform).toBe('') // la carte n'a jamais suivi le doigt
    fireEvent.pointerUp(f, { ...TOUCH, clientX: 150, clientY: 165 })
    expect(f.style.transform).toBe('')
    expect(deleteAction(li)).toBeNull()
  })

  it('souris : pas de glissement (la corbeille au survol sert sur Mac)', async () => {
    renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const li = row('Que garantit la RLS ?')
    swipe(face(li), [280, 150], { pointerId: 1, pointerType: 'mouse', isPrimary: true })
    expect(face(li).style.transform).toBe('')
    expect(deleteAction(li)).toBeNull()
  })

  it('une seule carte ouverte à la fois', async () => {
    renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const a = row('Que garantit la RLS ?')
    const b = row('Que mesure la stabilité ?')
    swipe(face(a), [280, 190])
    expect(deleteAction(a)).not.toBeNull()
    swipe(face(b), [280, 190], { ...TOUCH, pointerId: 9 })
    expect(deleteAction(b)).not.toBeNull()
    expect(deleteAction(a)).toBeNull()
    expect(face(a).style.transform).toBe('')
  })

  it('toucher ailleurs referme sans rien ouvrir ; toucher la carte ouverte la referme sans ouvrir « Modifier »', async () => {
    const { user } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const a = row('Que garantit la RLS ?')
    swipe(face(a), [280, 190])
    await user.click(within(row('Que mesure la stabilité ?')).getByText('Que mesure la stabilité ?')) // autre carte
    expect(deleteAction(a)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Modifier la carte' })).toBeNull()
    swipe(face(a), [280, 190], { ...TOUCH, pointerId: 11 })
    await user.click(screen.getByRole('searchbox')) // hors de la liste
    expect(deleteAction(a)).toBeNull()
    swipe(face(a), [280, 190], { ...TOUCH, pointerId: 12 })
    await user.click(within(a).getByText('Que garantit la RLS ?')) // la carte ouverte elle-même
    expect(deleteAction(a)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Modifier la carte' })).toBeNull()
    await user.click(within(a).getByText('Que garantit la RLS ?')) // refermée : un tap ouvre bien « Modifier »
    expect(await screen.findByRole('heading', { name: 'Modifier la carte' })).toBeTruthy()
  })

  it('la liste suit Dexie (synchro) : carte ajoutée, brouillon accepté, carte supprimée ailleurs', async () => {
    renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    await db.cards.put({ ...base, id: 'n1', source: 'vault', deck: 'x', source_path: 'x/n.md', front: 'Tirée du serveur ?', back: 'Oui.', tags: [], created_at: '2026-10-09T00:00:00Z' })
    await waitFor(() => expect(fronts()[0]).toBe('Tirée du serveur ?'))
    await db.cards.update('d1', { status: 'active' })
    await waitFor(() => expect(fronts()).toContain('Brouillon ?'))
    expect(within(screen.getByRole('list', { name: 'Filtrer par document' })).getByRole('button', { name: 'Vocal du 12/10, 1 carte' })).toBeTruthy()
    await db.cards.update('m1', { deleted_at: '2026-10-10T00:00:00Z' })
    await waitFor(() => expect(screen.queryByText('Que garantit la RLS ?')).toBeNull())
    expect(subtitle()).toBe('6 cartes')
  })

  it('Mac : la corbeille marche au clic et au clavier ; Annuler garde la carte', async () => {
    const { user, onWrite } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    const trashOf = (front: string) => within(row(front)).getByRole('button', { name: 'Supprimer la carte' })
    await user.click(trashOf('Que mesure la stabilité ?'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect((await db.cards.get('i1'))?.deleted_at).toBeNull()
    expect(onWrite).not.toHaveBeenCalled()
    trashOf('Que garantit la RLS ?').focus()
    await user.keyboard('{Enter}')
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Supprimer la carte' }))
    await waitFor(() => expect(screen.queryByText('Que garantit la RLS ?')).toBeNull())
    expect((await db.cards.get('m1'))?.deleted_at).not.toBeNull()
    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  it('échec de la suppression : message d’alerte, la liste ne bouge pas', async () => {
    const { user, onWrite } = renderScreen()
    await waitFor(() => expect(fronts()).toHaveLength(5))
    await user.click(within(row('Que garantit la RLS ?')).getByRole('button', { name: 'Supprimer la carte' }))
    vi.spyOn(db.cards, 'update').mockRejectedValueOnce(new Error('disque plein'))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Supprimer la carte' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Carte non supprimée. Réessaie.')
    expect(fronts()).toHaveLength(5)
    expect(onWrite).not.toHaveBeenCalled()
  })

  it('affichage par tranches : 80 cartes, préchargement sur le conteneur qui défile (root + marge), puis la suite', async () => {
    const observers: { cb: IntersectionObserverCallback; options?: IntersectionObserverInit }[] = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) { observers.push({ cb, options }) }
      observe() {}
      disconnect() {}
    })
    try {
      await db.cards.bulkPut(Array.from({ length: 300 }, (_, i) => ({
        ...base, id: `bulk${i}`, source: 'manual' as const, front: `Carte ${i} ?`, back: 'R.', tags: ['T'], created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
      })))
      renderScreen()
      await waitFor(() => expect(subtitle()).toBe('305 cartes'))
      expect(fronts()).toHaveLength(80)
      const last = observers.at(-1)!
      expect(last.options?.rootMargin).toBe('800px 0px')
      expect(last.options?.root).toBe(list().closest('main')!.parentElement) // la Page Konsta, qui défile
      act(() => last.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
      expect(fronts()).toHaveLength(240)
      act(() => observers.at(-1)!.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
      expect(fronts()).toHaveLength(305)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('filtre initial (#86, depuis « Tes créations ») : le document est déjà choisi ; « Tous » le retire', async () => {
    const { user } = renderScreen('pdf')
    await waitFor(() => expect(fronts()).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Cours FSRS.pdf, 2 cartes' }).getAttribute('aria-pressed')).toBe('true')
    expect(subtitle()).toBe('2 cartes')
    await user.click(screen.getByRole('button', { name: 'Tous' }))
    expect(fronts()).toHaveLength(5)
  })

  it('filtre initial sur un document qui n’existe plus : « Tous »', async () => {
    renderScreen('disparu')
    await waitFor(() => expect(fronts()).toHaveLength(5))
    expect(screen.getByRole('button', { name: 'Tous' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('document filtré qui disparaît : l’état revient à « Tous » et ne se réapplique pas si le document revient', async () => {
    renderScreen('pdf')
    await waitFor(() => expect(fronts()).toHaveLength(2))
    const gone = (deleted_at: string | null) => act(async () => {
      await db.cards.bulkUpdate([{ key: 'i1', changes: { deleted_at } }, { key: 'i2', changes: { deleted_at } }])
    })
    await gone('2026-10-08T00:00:00Z')
    await waitFor(() => expect(fronts()).toHaveLength(3))
    expect(screen.getByRole('button', { name: 'Tous' }).getAttribute('aria-pressed')).toBe('true')
    await gone(null)
    await waitFor(() => expect(fronts()).toHaveLength(5))
    expect(screen.getByRole('button', { name: 'Tous' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Cours FSRS.pdf, 2 cartes' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('flèche retour : onBack', async () => {
    const { user, onBack } = renderScreen()
    await user.click(screen.getByRole('button', { name: 'Accueil' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
