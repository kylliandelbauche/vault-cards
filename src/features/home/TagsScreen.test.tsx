import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { TAGS } from '../../../shared/tags'
import { tagsSubtitle, type HomeStats } from '../../lib/home'
import { TagsScreen } from './TagsScreen'

// [cartes, dues aujourd'hui]
const COUNTS: Record<string, [number, number]> = { ia: [7, 2], dev: [3, 3], culture: [5, 0] }
const stats: HomeStats = {
  today: 5, due: 2, fresh: 3, mastered: 0, total: 15, nextDueAt: null,
  tags: TAGS.map(t => ({ ...t, total: COUNTS[t.slug]?.[0] ?? 0, today: COUNTS[t.slug]?.[1] ?? 0 })),
}
const BLURRED = '.glass, .glass-card, .glass-btn:not(.on-glass)'

afterEach(cleanup)

function renderTags() {
  const props = { onStudy: vi.fn(), onBack: vi.fn() }
  const r = render(<KApp theme="ios"><TagsScreen data={{ status: 'ready', stats }} {...props} /></KApp>)
  return { ...r, ...props }
}

const group = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('button')

describe('TagsScreen v3 (#82)', () => {
  it('titre « Mes tags » dans la barre (<h1>) + sous-titre « n cartes à revoir », pas de gros titre dessous', () => {
    const { container } = renderTags()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Mes tags')
    expect(h1.closest('header')).toBeTruthy()
    expect(h1.nextElementSibling?.textContent).toBe('5 cartes à revoir')
    expect(container.querySelector('main h1')).toBeNull()
  })

  it('sous-titre : singulier, et « Tout est à jour » quand rien n’est dû', () => {
    expect(tagsSubtitle(1)).toBe('1 carte à revoir')
    expect(tagsSubtitle(0)).toBe('Tout est à jour')
  })

  it('« À revoir aujourd’hui » : tags avec des cartes dues, badge bleu = nombre de cartes dues', () => {
    renderTags()
    const due = group("À revoir aujourd'hui")
    expect(due.map(b => b.getAttribute('aria-label'))).toEqual(['IA & agents, 7 cartes, 2 à revoir', 'Dev & outils, 3 cartes, 3 à revoir'])
    expect(due.map(b => b.querySelector('.due-badge')?.textContent)).toEqual(['2', '3'])
    for (const b of due) {
      expect(b.querySelector('.due-badge')?.getAttribute('aria-hidden')).toBe('true')
      expect(b.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'glass-btn-neutral', 'tag-chip', 'h-11']))
      expect(b.className.split(' ')).not.toContain('on-glass') // posé sur le fond : son propre verre
    }
  })

  it('« À jour » : pastilles grises sans badge ni flou ; tags vides en pointillés, non cliquables', () => {
    renderTags()
    const upToDate = group('À jour')
    expect(upToDate).toHaveLength(6)
    expect(upToDate[0].getAttribute('aria-label')).toBe('Culture, 5 cartes, à jour')
    expect(upToDate[0].className.split(' ')).toEqual(expect.arrayContaining(['tag-chip-idle', 'on-glass']))
    expect(upToDate[0].hasAttribute('aria-disabled')).toBe(false)
    for (const b of upToDate) expect(b.querySelector('.due-badge')).toBeNull()
    for (const b of upToDate.slice(1)) {
      expect(b.getAttribute('aria-disabled')).toBe('true')
      expect(b.className).toContain('tag-chip-empty')
      expect(b.getAttribute('aria-label')).toMatch(/, 0 carte$/)
    }
  })

  it('tap → session du tag (dû ou à jour) ; tag vide non cliquable', async () => {
    const { onStudy } = renderTags()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /^Dev & outils/ }))
    await user.click(screen.getByRole('button', { name: /^Culture/ }))
    expect(onStudy.mock.calls).toEqual([['dev'], ['culture']])
    await user.click(screen.getByRole('button', { name: 'Sécurité, 0 carte' }))
    expect(onStudy).toHaveBeenCalledTimes(2)
  })

  it('flèche retour « Accueil » dans la barre ; surfaces floutées = les 2 tags dus, aucune imbriquée', async () => {
    const { container, onBack } = renderTags()
    await userEvent.setup().click(within(container.querySelector('header')!).getByRole('button', { name: 'Accueil' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll(BLURRED)).toHaveLength(2)
    expect(container.querySelectorAll('.glass-btn .glass-btn, .glass-card .glass-btn:not(.on-glass)')).toHaveLength(0)
  })

  it('texte seul : aucun emoji, aucune couleur par tag (pas de style en ligne)', () => {
    const { container } = renderTags()
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    for (const b of container.querySelectorAll('.tag-chip')) expect(b.getAttribute('style') ?? '').not.toMatch(/--chip|--tag/)
  })
})
