import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CardView } from './CardView'
import type { Card } from '../../lib/types'

const card = (tags: string[], source_title?: string | null): Card => ({
  id: 'a', deck: 'mon-deck', source_path: '3-Resources/veille/ia/prompt-caching-synthese.md', source_title, tags,
  front: 'Question ?', back: 'Réponse.', updated_at: '2026-10-13T00:00:00+00:00', deleted_at: null,
})

afterEach(cleanup)

describe('CardView : titre de la source', () => {
  it('affiche le titre sur une ligne tronquée, jamais le chemin local', () => {
    render(<CardView card={card(['ia'], 'Prompt caching : mesurer le gain')} revealed={false} onReveal={() => {}} />)
    const title = screen.getByText('Prompt caching : mesurer le gain')
    expect(title.className).toContain('truncate')
    expect(screen.queryByText(/3-Resources/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/veille|-synthese\.md/)
  })

  it('titre absent, null ou vide : repli sur le nom de fichier humanisé (sans chemin)', () => {
    for (const t of [undefined, null, '', '   ']) {
      render(<CardView card={card(['ia'], t)} revealed={false} onReveal={() => {}} />)
      expect(screen.getByText('Prompt caching').className).toContain('truncate')
      expect(document.body.textContent).not.toMatch(/3-Resources|-synthese\.md/)
      cleanup()
    }
  })
})

describe('CardView : tags', () => {
  it('affiche une pastille de texte par tag (aucun emoji), et jamais le deck', () => {
    render(<CardView card={card(['ia', 'securite'])} revealed={false} onReveal={() => {}} />)
    const pills = within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem')
    expect(pills.map(p => p.textContent)).toEqual(['IA & agents', 'Sécurité'])
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    expect(pills[0].className).toContain('tag-pill')
    // Verre neutre (#63) : aucune couleur par tag.
    for (const p of pills) expect(p.getAttribute('style')).toBeNull()
    expect(screen.queryByText(/mon-deck/)).toBeNull()
  })

  it('ignore un tag inconnu sans planter', () => {
    render(<CardView card={card(['cuisine', 'dev'])} revealed={false} onReveal={() => {}} />)
    const pills = within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem')
    expect(pills.map(p => p.textContent)).toEqual(['Dev & outils'])
  })

  it('dédoublonne un tag répété (la contrainte SQL ne refuse pas les doublons)', () => {
    render(<CardView card={card(['ia', 'ia'])} revealed={false} onReveal={() => {}} />)
    const list = screen.getByRole('list', { name: 'Tags' })
    expect(list.getAttribute('role')).toBe('list')
    expect(within(list).getAllByRole('listitem').map(p => p.textContent)).toEqual(['IA & agents'])
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

describe('CardView : zones de tap', () => {
  it('un tap sur la carte révèle la réponse', () => {
    const onReveal = vi.fn()
    render(<CardView card={card(['ia'])} revealed={false} onReveal={onReveal} />)
    fireEvent.click(screen.getByText('Question ?'))
    fireEvent.click(screen.getByRole('list', { name: 'Tags' }))
    expect(onReveal).toHaveBeenCalledTimes(2)
  })

  it('titre de la source affiché en texte, sans lien ; un tap dessus révèle aussi', () => {
    const onReveal = vi.fn()
    render(<CardView card={card([], 'Mon titre')} revealed={false} onReveal={onReveal} />)
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByText('Mon titre'))
    expect(onReveal).toHaveBeenCalledTimes(1)
  })

  it('réponse séparée par un trait une fois révélée', () => {
    render(<CardView card={card([])} revealed onReveal={() => {}} />)
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(screen.getByText('Réponse.')).toBeTruthy()
  })
})
