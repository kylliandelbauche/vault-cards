import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { VaultDB } from '../../lib/db'
import { stateFromReviews } from '../../lib/scheduler'
import type { Card } from '../../lib/types'
import { ReviewScreen } from './ReviewScreen'
import { memoryStore, useReviewSession, type ReviewSession, type ReviewStore } from './useReviewSession'

const card: Card = { id: 'a', source: 'vault', deck: 'd', tags: ['ia'], source_path: 'd/a.md', front: 'Question ?', back: 'Réponse.', updated_at: '2026-10-13T00:00:00+00:00', deleted_at: null }
const now = () => new Date('2026-10-13T10:00:00Z')

const session = (over: Partial<ReviewSession> = {}): ReviewSession => ({
  status: 'empty', current: null, revealed: false, saveFailed: false, reveal: vi.fn(), rate: vi.fn(),
  counts: { new: 0, learn: 0, due: 0 }, progress: 0, position: { n: 1, total: 1 }, stats: { again: 0, hard: 0, good: 0 }, nextDueAt: null, restart: vi.fn(), reviewAll: vi.fn(),
  edit: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined),
  ...over,
})
const reviewing = (over: Partial<ReviewSession> = {}) =>
  session({ status: 'reviewing', current: { card, state: stateFromReviews([]) }, counts: { new: 1, learn: 0, due: 0 }, ...over })

const renderScreen = (s: ReviewSession, title?: string) =>
  render(<KApp theme="ios"><ReviewScreen db={db} session={s} now={now} title={title} /></KApp>)

// Cache local (fake-indexeddb) : seulement lu par « Modifier la carte » (tags proposés).
const db = new VaultDB('review-screen-test')
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ReviewScreen', () => {
  const barText = (c: HTMLElement) => [...c.querySelector('header')!.querySelectorAll('p')].map(p => p.textContent)

  it('titre selon l’entrée (#82) : « Révision du jour » via Commencer à étudier, + « Carte 3 sur 21 »', () => {
    const { container } = renderScreen(reviewing({ position: { n: 3, total: 21 } }))
    expect(barText(container)).toEqual(['Révision du jour', 'Carte 3 sur 21'])
  })

  it('titre selon l’entrée (#82) : nom du tag depuis un tag, + « Carte 3 sur 10 »', () => {
    const { container } = renderScreen(reviewing({ position: { n: 3, total: 10 } }), 'IA & agents')
    expect(barText(container)).toEqual(['IA & agents', 'Carte 3 sur 10'])
  })

  it('pas de « Carte n sur N » hors révision (fin de session) ; plus d’indicateur de synchro ni de compteurs dans la barre', () => {
    const { container } = renderScreen(session({ status: 'done' }))
    expect(barText(container)).toEqual(['Révision du jour'])
    renderScreen(reviewing({ counts: { new: 12, learn: 3, due: 40 } }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText('12')).toBeNull()
  })

  it('barre de progression fine sous la barre pendant la révision', () => {
    const { container } = renderScreen(reviewing({ progress: 0.3 }))
    expect(container.querySelector('header .k-progressbar')).toBeTruthy()
  })

  it('« Réviser à nouveau » lance la révision libre', async () => {
    const s = session({ status: 'done', stats: { again: 0, hard: 0, good: 2 } })
    renderScreen(s)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réviser à nouveau' }))
    expect(s.reviewAll).toHaveBeenCalledTimes(1)
    expect(s.restart).not.toHaveBeenCalled()
  })

  it('premier lancement hors ligne sans cache : invite à se connecter', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderScreen(session({ status: 'empty' }))
    expect(screen.getByText('Connecte-toi à internet pour la première synchronisation.')).toBeTruthy()
  })

  it('aucune carte en ligne : message habituel', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    renderScreen(session({ status: 'empty' }))
    expect(screen.getByText("Aucune carte pour l'instant. Lance /flashcards sur le Mac.")).toBeTruthy()
  })

  it('lecture du cache en échec : message et bouton Réessayer', async () => {
    const s = session({ status: 'error' })
    renderScreen(s)
    expect(screen.getByRole('alert').textContent).toBe('Impossible de lire les cartes enregistrées sur cet appareil.')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Réessayer' }))
    expect(s.restart).toHaveBeenCalledTimes(1)
  })

  it('note non enregistrée : message court, la barre de notation reste', () => {
    renderScreen(reviewing({ revealed: true, saveFailed: true }))
    expect(screen.getByRole('alert').textContent).toBe('Note non enregistrée. Réessaie.')
    expect(screen.getByRole('button', { name: /Très bien/ })).toBeTruthy()
  })

  it('emplacement d’action unique, avant révélation : seulement « Afficher la réponse »', async () => {
    const s = reviewing()
    renderScreen(s)
    const actions = within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button')
    expect(actions.map(b => b.textContent)).toEqual(['Afficher la réponse'])
    expect(screen.queryByRole('button', { name: /Je ne sais pas|Moyen|Très bien/ })).toBeNull()
    await userEvent.setup().click(actions[0])
    expect(s.reveal).toHaveBeenCalledTimes(1)
  })

  it('emplacement d’action unique, après révélation : les 3 notations au même endroit', async () => {
    const s = reviewing({ revealed: true })
    renderScreen(s)
    expect(screen.getAllByRole('group', { name: 'Actions' })).toHaveLength(1)
    const actions = within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button')
    expect(actions.map(b => b.textContent?.replace(/\d.*$/, ''))).toEqual(['Je ne sais pas', 'Moyen', 'Très bien'])
    expect(screen.queryByRole('button', { name: 'Afficher la réponse' })).toBeNull()
    await userEvent.setup().click(actions[2])
    expect(s.rate).toHaveBeenCalledWith(3)
  })

  it('notation : 3 boutons en verre indépendants (lueur rouge, ambre, vert), cibles ≥ 44 px, sans opacité', () => {
    renderScreen(reviewing({ revealed: true }))
    const buttons = within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button')
    expect(buttons.map(b => b.className.match(/glass-btn-(\w+)/)?.[1])).toEqual(['again', 'hard', 'good'])
    for (const b of buttons) {
      expect(b.tagName).toBe('BUTTON')
      expect(b.getAttribute('type')).toBe('button')
      expect(b.className.split(' ')).toContain('glass-btn')
      expect(b.className).not.toMatch(/opacity/)
      expect(b.className).toContain('min-h-[76px]')
      expect(b.className.split(' ')).toContain('rating-btn')
      expect(b.closest('.glass, .glass-card')).toBeNull()
    }
  })

  it('notation : pastille d’icône opaque, libellé neutre, intervalle dans la couleur de la note', () => {
    renderScreen(reviewing({ revealed: true }))
    const buttons = within(screen.getByRole('group', { name: 'Actions' })).getAllByRole('button')
    for (const [b, tone] of buttons.map((b, i) => [b, ['again', 'hard', 'good'][i]] as const)) {
      const [pill, label, interval] = [...b.children] as HTMLElement[]
      expect(pill.getAttribute('aria-hidden')).toBe('true')
      expect(pill.className).toContain(`bg-${tone}-pill`)
      expect(pill.className).not.toMatch(/glass|backdrop/)
      expect(label.className).toBe('')
      expect(interval.className).toContain(`text-${tone}-glass`)
      expect(interval.textContent).toMatch(/\d/)
    }
  })

  it('« Afficher la réponse » : bouton en verre bleu indépendant, 56 px', () => {
    renderScreen(reviewing())
    const btn = screen.getByRole('button', { name: 'Afficher la réponse' })
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-new', 'h-14']))
    // Libellé seul, centré : plus de chevron ni de pastille.
    expect(btn.querySelector('svg, span')).toBeNull()
    expect(btn.textContent).toBe('Afficher la réponse')
    expect(btn.closest('footer')?.className).toContain('action-dock')
    expect(btn.closest('.glass, .glass-card')).toBeNull()
  })

  it('barres superposées au contenu, marges de zone sûre gauche/droite ; haut sur un fondu (sans bandeau en verre), bas transparent', () => {
    const { container } = renderScreen(reviewing())
    const header = container.querySelector('header')!
    const footer = container.querySelector('footer')!
    for (const bar of [header, footer]) {
      expect(bar.className).toMatch(/\bsticky\b/)
      expect(bar.className).toMatch(/--k-safe-area-left/)
      expect(bar.className).toMatch(/--k-safe-area-right/)
    }
    expect(header.querySelector('.glass, .glass-card')).toBeNull()
    expect(header.className.split(' ')).toContain('bar-fade')
    // #39 : plus de barre en verre autour des boutons, chacun est son propre verre.
    expect(footer.querySelector('.glass, .glass-card')).toBeNull()
    expect(footer.querySelectorAll('.glass-btn')).toHaveLength(1)
    expect(container.querySelector('main')!.className).toMatch(/--k-safe-area-left/)
  })

  const SURFACES = '.glass, .glass-card, .glass-btn:not(.on-glass)'
  const NESTED = ['.glass', '.glass-card', '.glass-btn'].flatMap(a => ['.glass', '.glass-card', '.glass-btn'].map(b => `${a} ${b}`)).join(', ')

  it.each([
    ['avant dévoilement', false, 2], // carte + « Afficher la réponse » (boutons de la barre : verre imité, sans flou)
    ['après dévoilement', true, 4], // carte + 3 notes
  ])('surfaces floutées %s : %i, aucune imbriquée', (_, revealed, n) => {
    const { container } = renderScreen(reviewing({ revealed }))
    expect(container.querySelectorAll('main .glass-card')).toHaveLength(1)
    expect(container.querySelectorAll(SURFACES)).toHaveLength(n)
    expect(container.querySelectorAll(NESTED)).toHaveLength(0)
  })

  it('fin de session : bilan sur une carte en verre, boutons en verre en dehors (3 surfaces, aucune imbriquée)', () => {
    const { container } = render(
      <KApp theme="ios"><ReviewScreen db={db} session={session({ status: 'done' })} now={now} onBack={vi.fn()} /></KApp>,
    )
    const restart = screen.getByRole('button', { name: 'Réviser à nouveau' })
    const home = screen.getByRole('button', { name: "Retour à l'accueil" })
    expect(restart.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-new']))
    expect(home.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-neutral']))
    expect(container.querySelector('main .glass-card')?.textContent).toContain('Session terminée')
    expect(container.querySelectorAll(SURFACES)).toHaveLength(3)
    expect(container.querySelectorAll(NESTED)).toHaveLength(0)
  })

  it('fin de session : « Retour à l’accueil » appelle onBack', async () => {
    const onBack = vi.fn()
    render(<KApp theme="ios"><ReviewScreen db={db} session={session({ status: 'done' })} now={now} onBack={onBack} /></KApp>)
    await userEvent.setup().click(screen.getByRole('button', { name: "Retour à l'accueil" }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('flèche retour ronde en tête de la barre du haut : étiquetée « Accueil », cible 48 px, appelle onBack', async () => {
    const onBack = vi.fn()
    const { container } = render(<KApp theme="ios"><ReviewScreen db={db} session={reviewing()} now={now} onBack={onBack} /></KApp>)
    const header = container.querySelector('header')!
    const btn = within(header).getByRole('button', { name: 'Accueil' })
    expect(btn.className).toMatch(/\bsize-12\b/)
    expect(within(header).getAllByRole('button')[0]).toBe(btn)
    await userEvent.setup().click(btn)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('sans onBack : pas de chevron', () => {
    renderScreen(reviewing())
    expect(screen.queryByRole('button', { name: 'Accueil' })).toBeNull()
  })

  describe('menu ⋯ de la carte (#73)', () => {
    const menuButton = () => screen.getByRole('button', { name: 'Actions de la carte' })

    it('⋯ en haut à droite de la carte (question et réponse) : cible 44 px, aria-haspopup / aria-expanded', () => {
      const { container } = renderScreen(reviewing())
      const btn = menuButton()
      expect(container.querySelector('article')!.contains(btn)).toBe(true)
      expect(btn.className).toMatch(/\bsize-11\b/)
      expect(btn.getAttribute('aria-haspopup')).toBe('menu')
      expect(btn.getAttribute('aria-expanded')).toBe('false')
      cleanup()
      renderScreen(reviewing({ revealed: true }))
      expect(menuButton()).toBeTruthy()
    })

    it('ouvre le menu sans révéler la carte ; Modifier (focus) et Supprimer ; Échap ferme et rend le focus au ⋯', async () => {
      const s = reviewing()
      const { container } = renderScreen(s)
      const user = userEvent.setup()
      await user.click(menuButton())
      expect(s.reveal).not.toHaveBeenCalled()
      expect(menuButton().getAttribute('aria-expanded')).toBe('true')
      const menu = screen.getByRole('menu', { name: 'Actions de la carte' })
      expect(within(menu).getAllByRole('menuitem').map(b => b.textContent)).toEqual(['Modifier', 'Supprimer'])
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Modifier' }))
      expect(within(menu).getByRole('menuitem', { name: 'Supprimer' }).className).toMatch(/\btext-again\b/)
      // Rendu hors de la carte floutée : pas de flou imbriqué.
      expect(container.querySelector('article')!.contains(menu)).toBe(false)
      await user.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Supprimer' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).toBeNull()
      expect(document.activeElement).toBe(menuButton())
    })

    it('menu ouvert : les raccourcis ne révèlent ni ne notent ; un tap à côté ferme le menu sans toucher la carte', async () => {
      const s = reviewing({ revealed: true })
      renderScreen(s)
      const user = userEvent.setup()
      await user.click(menuButton())
      fireEvent.keyDown(window, { key: '3' })
      fireEvent.keyDown(document.body, { key: ' ' })
      expect(s.rate).not.toHaveBeenCalled()
      await user.click(document.querySelector('.fixed.inset-0 > [aria-hidden="true"]')!)
      expect(screen.queryByRole('menu')).toBeNull()
      expect(s.reveal).not.toHaveBeenCalled()
      expect(s.rate).not.toHaveBeenCalled()
    })

    it('Supprimer → confirmation ; Annuler ne supprime rien, « Supprimer » supprime puis synchronise', async () => {
      const s = reviewing()
      const onWrite = vi.fn()
      render(<KApp theme="ios"><ReviewScreen db={db} session={s} now={now} onWrite={onWrite} /></KApp>)
      const user = userEvent.setup()
      await user.click(menuButton())
      await user.click(screen.getByRole('menuitem', { name: 'Supprimer' }))
      let dialog = screen.getByRole('alertdialog', { name: 'Supprimer cette carte ?' })
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Annuler' }))
      await user.click(within(dialog).getByRole('button', { name: 'Annuler' }))
      expect(screen.queryByRole('alertdialog')).toBeNull()
      expect(s.remove).not.toHaveBeenCalled()
      await user.click(menuButton())
      await user.click(screen.getByRole('menuitem', { name: 'Supprimer' }))
      dialog = screen.getByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: 'Supprimer' }))
      expect(s.remove).toHaveBeenCalledTimes(1)
      expect(onWrite).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    it('suppression en échec : message, rien de synchronisé', async () => {
      const s = reviewing({ remove: vi.fn().mockRejectedValue(new Error('IndexedDB')) })
      const onWrite = vi.fn()
      render(<KApp theme="ios"><ReviewScreen db={db} session={s} now={now} onWrite={onWrite} /></KApp>)
      const user = userEvent.setup()
      await user.click(menuButton())
      await user.click(screen.getByRole('menuitem', { name: 'Supprimer' }))
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))
      expect(await screen.findByText('Carte non supprimée. Réessaie.')).toBeTruthy()
      expect(onWrite).not.toHaveBeenCalled()
    })

    describe('avec une vraie session', () => {
      let tick = 0
      const clock = () => new Date(Date.parse('2026-10-13T10:00:00Z') + 1000 * tick++) // après la garde anti double tap
      const cards: Card[] = ['a', 'b'].map(id => ({ ...card, id, front: `Question ${id} ?`, back: `Réponse ${id}.` }))
      function Live({ store, onWrite }: { store: ReviewStore; onWrite?(): void }) {
        const s = useReviewSession(store, clock)
        return <ReviewScreen db={db} session={s} now={clock} onWrite={onWrite} />
      }
      const renderLive = (store: ReviewStore, onWrite?: () => void) => render(<KApp theme="ios"><Live store={store} onWrite={onWrite} /></KApp>)

      it('Modifier → « Modifier la carte » ; ✓ enregistre, retour sur la même carte avec le nouveau texte, synchro', async () => {
        const store = memoryStore(cards)
        const onWrite = vi.fn()
        renderLive(store, onWrite)
        const user = userEvent.setup()
        await screen.findByText('Question a ?')
        await user.click(menuButton())
        await user.click(screen.getByRole('menuitem', { name: 'Modifier' }))
        expect(screen.getByRole('heading', { name: 'Modifier la carte' })).toBeTruthy()
        // Espace dans le champ : écrit, ne révèle rien derrière.
        const front = screen.getByLabelText('QUESTION')
        await user.clear(front)
        await user.type(front, 'Question modifiée ?')
        await user.click(screen.getByRole('button', { name: 'Enregistrer' }))
        await screen.findByText('Question modifiée ?')
        expect(screen.queryByText('Réponse a.')).toBeNull() // toujours côté question
        expect(screen.getByText('Carte 1 sur 2')).toBeTruthy()
        expect((await store.loadCards()).find(c => c.id === 'a')!.front).toBe('Question modifiée ?')
        expect(await store.loadReviews()).toHaveLength(0)
        expect(onWrite).toHaveBeenCalledTimes(1)
      })

      it('Modifier puis ✕ sans modification : retour à la révision, rien d’écrit', async () => {
        const store = memoryStore(cards)
        const update = vi.spyOn(store, 'updateCard')
        renderLive(store)
        const user = userEvent.setup()
        await screen.findByText('Question a ?')
        await user.click(menuButton())
        await user.click(screen.getByRole('menuitem', { name: 'Modifier' }))
        await user.click(screen.getByRole('button', { name: 'Fermer' }))
        expect(await screen.findByText('Question a ?')).toBeTruthy()
        expect(update).not.toHaveBeenCalled()
      })

      it('Supprimer → confirmer : carte suivante, « Carte 1 sur 1 », aucune note', async () => {
        const store = memoryStore(cards)
        renderLive(store)
        const user = userEvent.setup()
        await screen.findByText('Question a ?')
        await user.click(menuButton())
        await user.click(screen.getByRole('menuitem', { name: 'Supprimer' }))
        await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Supprimer' }))
        await screen.findByText('Question b ?')
        expect(screen.getByText('Carte 1 sur 1')).toBeTruthy()
        await act(async () => {})
        expect(await store.loadReviews()).toHaveLength(0)
        await waitFor(async () => expect((await store.loadCards()).find(c => c.id === 'a')!.deleted_at).not.toBeNull())
      })
    })
  })
})
