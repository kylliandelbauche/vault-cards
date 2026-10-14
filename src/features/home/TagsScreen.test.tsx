import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { TAGS } from '../../../shared/tags'
import type { HomeStats } from '../../lib/home'
import { TagsScreen } from './TagsScreen'

const COUNTS: Record<string, [number, number]> = { ia: [7, 2], dev: [3, 3], culture: [5, 0] }
const stats: HomeStats = {
  today: 5, due: 2, fresh: 3, mastered: 0, total: 15, nextDueAt: null,
  tags: TAGS.map(t => ({ ...t, total: COUNTS[t.slug]?.[0] ?? 0, today: COUNTS[t.slug]?.[1] ?? 0, due: 0, fresh: 0, mastered: 0, nextDueAt: null })),
}
const SURFACES = '.glass, .glass-card, .glass-btn:not(.on-glass)'

afterEach(cleanup)

function renderTags() {
  const props = { onStudy: vi.fn(), onBack: vi.fn() }
  const r = render(<KApp theme="ios"><TagsScreen data={{ status: 'ready', stats }} sync="synced" {...props} /></KApp>)
  return { ...r, ...props }
}

describe('TagsScreen', () => {
  it('les 8 tags triés (cartes décroissant, vides en dernier) avec nombre de cartes et à revoir aujourd’hui', () => {
    renderTags()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Mes tags')
    const buttons = within(screen.getByRole('list')).getAllByRole('button')
    expect(buttons).toHaveLength(8)
    expect(buttons.slice(0, 3).map(b => b.getAttribute('aria-label'))).toEqual([
      "IA & agents, 7 cartes, 2 à revoir aujourd'hui",
      "Culture, 5 cartes, 0 à revoir aujourd'hui",
      "Dev & outils, 3 cartes, 3 à revoir aujourd'hui",
    ])
    expect(buttons.slice(3).every(b => b.getAttribute('aria-disabled') === 'true')).toBe(true)
  })

  it('tap → session du tag ; tag vide non cliquable', async () => {
    const { onStudy } = renderTags()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Dev & outils/ }))
    expect(onStudy).toHaveBeenCalledWith('dev')
    await user.click(screen.getByRole('button', { name: 'Sécurité, 0 carte' }))
    expect(onStudy).toHaveBeenCalledTimes(1)
  })

  it('chevron retour « Accueil » dans la barre ; titre « Vault Cards » ; 2 surfaces floutées', async () => {
    const { container, onBack } = renderTags()
    const header = container.querySelector('header')!
    expect(within(header).getByText('Vault Cards')).toBeTruthy()
    await userEvent.setup().click(within(header).getByRole('button', { name: 'Accueil' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll(SURFACES)).toHaveLength(2)
  })
})

describe('TagsScreen : texte seul, verre neutre (#63)', () => {
  it('aucun emoji rendu', () => {
    renderTags()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('aucune couleur par tag : verre neutre, sans style en ligne ; vides grisés (tag-chip-empty)', () => {
    const { container } = renderTags()
    const buttons = within(screen.getByRole('list')).getAllByRole('button')
    for (const b of buttons) {
      expect(b.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn-neutral', 'on-glass', 'tag-chip']))
      expect(b.getAttribute('style') ?? '').not.toMatch(/--chip|--tag/)
    }
    expect(container.innerHTML).not.toMatch(/--tag-[a-z]+-fg|--chip-fg/)
    expect(buttons.slice(3).every(b => b.className.includes('tag-chip-empty'))).toBe(true)
  })
})
