import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { CardView } from './CardView'
import type { Card } from '../../lib/types'

const card = (tags: string[]): Card => ({
  id: 'a', deck: 'mon-deck', source_path: '3-Resources/veille/ia/a-synthese.md', tags,
  front: 'Question ?', back: 'Réponse.', updated_at: '2026-10-13T00:00:00+00:00', deleted_at: null,
})

afterEach(cleanup)

describe('CardView : tags', () => {
  it('affiche une pastille emoji + label par tag, et jamais le deck', () => {
    render(<CardView card={card(['ia', 'securite'])} revealed={false} onReveal={() => {}} />)
    const pills = within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem')
    expect(pills.map(p => p.textContent)).toEqual(['🤖 IA & agents', '🔐 Sécurité'])
    expect(pills[0].style.backgroundColor).toBe('var(--tag-violet-bg)')
    expect(screen.queryByText(/mon-deck/)).toBeNull()
    expect(screen.getByText('3-Resources/veille/ia/a-synthese.md')).toBeTruthy()
  })

  it('ignore un tag inconnu sans planter', () => {
    render(<CardView card={card(['cuisine', 'dev'])} revealed={false} onReveal={() => {}} />)
    const pills = within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem')
    expect(pills.map(p => p.textContent)).toEqual(['🛠️ Dev & outils'])
  })

  it('dédoublonne un tag répété (la contrainte SQL ne refuse pas les doublons)', () => {
    render(<CardView card={card(['ia', 'ia'])} revealed={false} onReveal={() => {}} />)
    const list = screen.getByRole('list', { name: 'Tags' })
    expect(list.getAttribute('role')).toBe('list')
    expect(within(list).getAllByRole('listitem').map(p => p.textContent)).toEqual(['🤖 IA & agents'])
  })

  it('tags null (ligne serveur ou cache anormal) : pas de liste, pas de plantage', () => {
    const broken = { ...card([]), tags: null } as unknown as Card
    render(<CardView card={broken} revealed={false} onReveal={() => {}} />)
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull()
    expect(screen.getByText('Question ?')).toBeTruthy()
  })

  it('aucun tag connu (ou tags absents d’un vieux cache) : pas de liste', () => {
    render(<CardView card={card(['cuisine'])} revealed={false} onReveal={() => {}} />)
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull()
    const legacy = { ...card([]), tags: undefined } as unknown as Card
    render(<CardView card={legacy} revealed={false} onReveal={() => {}} />)
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull()
  })
})
