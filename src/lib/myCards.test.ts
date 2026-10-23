import { describe, expect, it } from 'vitest'
import { documentKind, filterCards, foldText, indexCards, UNTITLED_DOCUMENT } from './myCards'
import type { Card } from './types'

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id, source: 'vault', deck: 'x', source_path: `x/${id}.md`, source_title: `Note ${id}`, tags: ['Mémoire'],
  front: `Question ${id} ?`, back: `Réponse ${id}.`, created_at: `2026-10-0${id.length}T00:00:00Z`, updated_at: '2026-10-01T00:00:00Z', deleted_at: null,
  ...over,
})
const inbox = (id: string, inboxId: string, title: string | null, created: string, over: Partial<Card> = {}) =>
  card(id, { source: 'inbox', inbox_id: inboxId, source_title: title, deck: null, source_path: null, status: 'active', created_at: created, ...over })

describe('foldText', () => {
  it('sans accents, sans casse, ligatures développées', () => {
    expect(foldText('Éléphant À Noël')).toBe('elephant a noel')
    expect(foldText('Cœur ÆTHER')).toBe('coeur aether')
  })
})

describe('indexCards (#80)', () => {
  it('exclut les brouillons et les cartes supprimées ; les plus récentes d’abord', () => {
    const { cards } = indexCards([
      card('a', { created_at: '2026-10-01T00:00:00Z' }),
      card('b', { created_at: '2026-10-03T00:00:00Z' }),
      inbox('d', 'i1', 'Cours.pdf', '2026-10-04T00:00:00Z', { status: 'draft' }),
      card('x', { deleted_at: '2026-10-05T00:00:00Z' }),
      card('c', { created_at: undefined, updated_at: '2026-10-02T00:00:00Z' }), // vieux cache : repli sur updated_at
    ])
    expect(cards.map(c => c.card.id)).toEqual(['b', 'c', 'a'])
  })

  it('documents : cartes inbox actives regroupées par inbox_id, libellé = source_title, le plus récent d’abord', () => {
    const { documents } = indexCards([
      card('v'), card('m', { source: 'manual', deck: null, source_path: null, source_title: null }),
      inbox('p1', 'pdf', 'Cours FSRS.pdf', '2026-10-10T00:00:00Z'),
      inbox('p2', 'pdf', 'Cours FSRS.pdf', '2026-10-11T00:00:00Z'),
      inbox('f1', 'photo', '  Photo du 18/10 ', '2026-10-18T00:00:00Z'),
      inbox('n1', 'sans-titre', null, '2026-10-01T00:00:00Z'),
      inbox('d1', 'brouillons', 'Vocal du 12/10', '2026-10-20T00:00:00Z', { status: 'draft' }), // que des brouillons : absent
    ])
    expect(documents).toEqual([
      { id: 'photo', label: 'Photo du 18/10', count: 1 },
      { id: 'pdf', label: 'Cours FSRS.pdf', count: 2 },
      { id: 'sans-titre', label: UNTITLED_DOCUMENT, count: 1 },
    ])
  })
})

describe('filterCards (#80)', () => {
  const { cards } = indexCards([
    card('a', { front: 'Qu’est-ce que la répétition espacée ?', back: 'Revoir avant d’oublier.', tags: ['Mémoire'] }),
    card('b', { front: 'Trois valeurs de FSRS ?', back: 'Stabilité, difficulté, récupérabilité.', tags: ['Algorithmes'] }),
    inbox('c', 'pdf', 'Cours FSRS.pdf', '2026-10-10T00:00:00Z', { front: 'Stabilité ?', back: 'Jours avant 90 %.', tags: ['FSRS'] }),
    inbox('d', 'photo', 'Photo du 18/10', '2026-10-18T00:00:00Z', { front: 'RLS ?', back: 'Ses propres lignes.', tags: ['Sécurité'] }),
  ])
  const ids = (q: string, doc: string | null = null) => filterCards(cards, q, doc).map(c => c.card.id).sort()

  it('vide : tout', () => expect(ids('')).toEqual(['a', 'b', 'c', 'd']))
  it('insensible à la casse et aux accents, dans les deux sens', () => {
    expect(ids('REPETITION')).toEqual(['a'])
    expect(ids('stabilite')).toEqual(['b', 'c'])
    expect(ids('Sécu')).toEqual(['d'])
    expect(ids('securite')).toEqual(['d'])
  })
  it('porte sur la question, la réponse, les tags et le nom du document ; tous les mots, en tout ordre', () => {
    expect(ids('oublier')).toEqual(['a'])
    expect(ids('algorithmes')).toEqual(['b'])
    expect(ids('fsrs.pdf')).toEqual(['c'])
    expect(ids('photo 18/10')).toEqual(['d'])
    expect(ids('jours stabilité')).toEqual(['c'])
    expect(ids('jours rls')).toEqual([])
  })
  it('se combine avec le document choisi', () => {
    expect(ids('', 'pdf')).toEqual(['c'])
    expect(ids('stabilite', 'pdf')).toEqual(['c'])
    expect(ids('rls', 'pdf')).toEqual([])
  })
  it('le titre d’une note du vault n’est pas un nom de document', () => expect(ids('note a')).toEqual([]))
})

describe('documentKind', () => {
  it('photo, vocal ou fichier', () => {
    expect(documentKind('Photo du 18/10')).toBe('photo')
    expect(documentKind('IMG_0042.HEIC')).toBe('photo')
    expect(documentKind('Vocal du 12/10')).toBe('audio')
    expect(documentKind('Cours FSRS.pdf')).toBe('file')
    expect(documentKind('Texte collé')).toBe('file')
  })
})
