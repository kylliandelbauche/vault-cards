import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { stateFromReviews } from '../../lib/scheduler'
import type { Card } from '../../lib/types'
import { ReviewScreen } from './ReviewScreen'
import type { SyncIndicator } from './useAutoSync'
import type { ReviewSession } from './useReviewSession'

const card: Card = { id: 'a', source: 'vault', deck: 'd', tags: ['ia'], source_path: 'd/a.md', front: 'Question ?', back: 'Réponse.', updated_at: '2026-10-13T00:00:00+00:00', deleted_at: null }
const now = () => new Date('2026-10-13T10:00:00Z')

const session = (over: Partial<ReviewSession> = {}): ReviewSession => ({
  status: 'empty', current: null, revealed: false, saveFailed: false, reveal: vi.fn(), rate: vi.fn(),
  counts: { new: 0, learn: 0, due: 0 }, progress: 0, stats: { again: 0, hard: 0, good: 0 }, nextDueAt: null, restart: vi.fn(), reviewAll: vi.fn(),
  ...over,
})
const reviewing = (over: Partial<ReviewSession> = {}) =>
  session({ status: 'reviewing', current: { card, state: stateFromReviews([]) }, counts: { new: 1, learn: 0, due: 0 }, ...over })

const renderScreen = (s: ReviewSession, sync: SyncIndicator = 'synced') =>
  render(<KApp theme="ios"><ReviewScreen session={s} now={now} sync={sync} /></KApp>)

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('ReviewScreen', () => {
  it.each([
    ['synced', 'Synchronisé'],
    ['unsynced', 'Non synchronisé'],
    ['syncing', 'Synchronisation…'],
  ] as const)('indicateur de synchro toujours visible : %s → « %s »', (sync, label) => {
    renderScreen(reviewing(), sync)
    expect(screen.getByRole('status').textContent).toBe(label)
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

  it('compteurs lisibles par VoiceOver : le libellé est dans le texte, pas dans un aria-label', () => {
    renderScreen(reviewing({ counts: { new: 12, learn: 3, due: 40 } }))
    for (const label of ['12 nouvelles', '3 à revoir', '40 dues']) {
      const pill = screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === label)
      expect(pill.hasAttribute('aria-label')).toBe(false)
      expect(pill.hasAttribute('title')).toBe(false)
    }
  })

  it('indicateur de synchro : texte opaque, point animé seulement si les animations sont permises', () => {
    renderScreen(reviewing(), 'syncing')
    const badge = screen.getByRole('status')
    expect(badge.className).not.toMatch(/opacity/)
    expect(badge.parentElement?.className ?? '').not.toMatch(/opacity/)
    const dot = badge.querySelector('[aria-hidden]')!
    expect(dot.className).toMatch(/motion-safe:animate-pulse/)
    expect(dot.className.split(' ')).not.toContain('animate-pulse')
  })

  it('barres superposées au contenu, marges de zone sûre gauche/droite ; barre du haut en verre, bas transparent', () => {
    const { container } = renderScreen(reviewing())
    const header = container.querySelector('header')!
    const footer = container.querySelector('footer')!
    for (const bar of [header, footer]) {
      expect(bar.className).toMatch(/\bsticky\b/)
      expect(bar.className).toMatch(/--k-safe-area-left/)
      expect(bar.className).toMatch(/--k-safe-area-right/)
    }
    expect(header.querySelector('.glass')).toBeTruthy()
    // #39 : plus de barre en verre autour des boutons, chacun est son propre verre.
    expect(footer.querySelector('.glass, .glass-card')).toBeNull()
    expect(footer.querySelectorAll('.glass-btn')).toHaveLength(1)
    expect(container.querySelector('main')!.className).toMatch(/--k-safe-area-left/)
  })

  const SURFACES = '.glass, .glass-card, .glass-btn'
  const NESTED = ['.glass', '.glass-card', '.glass-btn'].flatMap(a => ['.glass', '.glass-card', '.glass-btn'].map(b => `${a} ${b}`)).join(', ')

  it.each([
    ['avant dévoilement', false, 3], // barre du haut + carte + « Afficher la réponse »
    ['après dévoilement', true, 5], // barre du haut + carte + 3 notes
  ])('surfaces floutées %s : %i, aucune imbriquée', (_, revealed, n) => {
    const { container } = renderScreen(reviewing({ revealed }))
    expect(container.querySelectorAll('main .glass-card')).toHaveLength(1)
    expect(container.querySelectorAll(SURFACES)).toHaveLength(n)
    expect(container.querySelectorAll(NESTED)).toHaveLength(0)
  })

  it('fin de session : bilan sur une carte en verre, boutons en verre en dehors (4 surfaces, aucune imbriquée)', () => {
    const { container } = render(
      <KApp theme="ios"><ReviewScreen session={session({ status: 'done' })} now={now} sync="synced" onBack={vi.fn()} /></KApp>,
    )
    const restart = screen.getByRole('button', { name: 'Réviser à nouveau' })
    const home = screen.getByRole('button', { name: "Retour à l'accueil" })
    expect(restart.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-new']))
    expect(home.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-neutral']))
    expect(container.querySelector('main .glass-card')?.textContent).toContain('Session terminée')
    expect(container.querySelectorAll(SURFACES)).toHaveLength(4)
    expect(container.querySelectorAll(NESTED)).toHaveLength(0)
  })

  it('fin de session : « Retour à l’accueil » appelle onBack', async () => {
    const onBack = vi.fn()
    render(<KApp theme="ios"><ReviewScreen session={session({ status: 'done' })} now={now} onBack={onBack} /></KApp>)
    await userEvent.setup().click(screen.getByRole('button', { name: "Retour à l'accueil" }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('chevron retour en tête de la barre du haut : étiqueté « Accueil », cible 44 px, appelle onBack', async () => {
    const onBack = vi.fn()
    const { container } = render(<KApp theme="ios"><ReviewScreen session={reviewing()} now={now} sync="synced" onBack={onBack} /></KApp>)
    const header = container.querySelector('header')!
    const btn = within(header).getByRole('button', { name: 'Accueil' })
    expect(btn.className).toMatch(/\bsize-11\b/)
    expect(within(header).getAllByRole('button')[0]).toBe(btn)
    await userEvent.setup().click(btn)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('titre de la barre : « Vault Cards » par défaut, nom du tag pour une session par tag ; plus de déconnexion ici', () => {
    const { container, rerender } = renderScreen(reviewing())
    expect(container.querySelector('header p')?.textContent).toBe('Vault Cards')
    rerender(<KApp theme="ios"><ReviewScreen session={reviewing()} now={now} title="IA & agents" onBack={vi.fn()} /></KApp>)
    expect(container.querySelector('header p')?.textContent).toBe('IA & agents')
    expect(screen.queryByRole('button', { name: 'Déconnexion' })).toBeNull()
  })

  it('sans onBack : pas de chevron', () => {
    renderScreen(reviewing())
    expect(screen.queryByRole('button', { name: 'Accueil' })).toBeNull()
  })
})
