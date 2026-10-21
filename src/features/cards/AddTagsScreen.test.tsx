import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { AddTagsScreen } from './AddTagsScreen'
import { indexLetter } from './useTagChoices'

afterEach(cleanup)

const CHOICES = [
  { name: 'Argent & business', cards: 23 },
  { name: 'cerveau', cards: 1 },
  { name: 'Culture', cards: 15 },
  { name: 'Dev & outils', cards: 41 },
  { name: 'IA & agents', cards: 58 },
  { name: 'Éthique', cards: 0 },
]

function renderScreen(initial: string[] = ['IA & agents']) {
  const onDone = vi.fn()
  const onCancel = vi.fn()
  render(<KApp theme="ios"><AddTagsScreen initial={initial} choices={CHOICES} onDone={onDone} onCancel={onCancel} /></KApp>)
  return { onDone, onCancel, user: userEvent.setup() }
}

const onCard = () => within(screen.getByRole('region', { name: /^SUR CETTE CARTE/ }))
const chips = () => onCard().queryAllByRole('listitem').map(li => li.textContent)
const search = () => screen.getByRole('searchbox', { name: 'Rechercher ou créer un tag' }) as HTMLInputElement
const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name.replace(/[&]/g, '\\&')}`) })

describe('AddTagsScreen (#79)', () => {
  it('liste A–Z par lettre (accents et casse ignorés), nombre de cartes, tags de la carte cochés', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: 'SUR CETTE CARTE · 1' })).toBeTruthy()
    expect(chips()).toEqual(['IA & agents'])
    const sections = screen.getAllByRole('region').filter(r => r.id.startsWith('tags-')).map(r => r.getAttribute('aria-label'))
    expect(sections).toEqual(['A', 'C', 'D', 'E', 'I'])
    const c = within(screen.getByRole('region', { name: 'C' })).getAllByRole('button').map(b => b.textContent)
    expect(c).toEqual(['cerveau1 carte', 'Culture15 cartes'])
    expect(row('IA & agents').getAttribute('aria-pressed')).toBe('true')
    expect(row('Éthique').textContent).toContain('0 carte')
    // Index : une lettre sans tag est désactivée.
    expect((screen.getByRole('button', { name: 'Aller à B' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Aller à C' }) as HTMLButtonElement).disabled).toBe(false)
    expect(indexLetter('Éthique')).toBe('E')
    expect(indexLetter('42 règles')).toBe('#')
  })

  it('toucher une ligne ajoute puis retire, plusieurs à la suite ; × de la rangée retire ; ✓ rend la liste', async () => {
    const { user, onDone } = renderScreen()
    await user.click(row('Dev & outils'))
    await user.click(row('Culture'))
    expect(chips()).toEqual(['IA & agents', 'Dev & outils', 'Culture'])
    await user.click(row('Culture'))
    await user.click(onCard().getByRole('button', { name: 'Retirer IA & agents' }))
    expect(screen.getByRole('heading', { name: 'SUR CETTE CARTE · 1' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Valider les tags' }))
    expect(onDone).toHaveBeenCalledWith(['Dev & outils'])
  })

  it('recherche : filtre sans tenir compte de la casse ; pas de nom identique → « + Créer » ; aucun résultat → seule ligne', async () => {
    const { user } = renderScreen()
    await user.type(search(), 'CULT')
    expect(row('Culture')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Dev & outils/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Créer « CULT »' })).toBeTruthy()
    await user.clear(search())
    await user.type(search(), 'culture')
    expect(screen.queryByRole('button', { name: /^Créer/ })).toBeNull() // existe déjà (casse ignorée)
    await user.clear(search())
    await user.type(search(), 'Mémoire')
    const rows = screen.getAllByRole('button').filter(b => b.closest('main') && !b.getAttribute('aria-label'))
    expect(rows.map(b => b.textContent)).toEqual(['Créer « Mémoire »'])
  })

  it('« + Créer » : tag créé et ajouté en un geste, bulle en premier, champ vidé ; Entrée fait pareil', async () => {
    const { user, onDone } = renderScreen()
    await user.type(search(), '  Chimie   organique ')
    await user.click(screen.getByRole('button', { name: 'Créer « Chimie organique »' }))
    expect(chips()).toEqual(['Chimie organique', 'IA & agents'])
    expect(search().value).toBe('')
    expect(row('Chimie organique').getAttribute('aria-pressed')).toBe('true') // visible dans la liste, à 0 carte
    await user.type(search(), 'Mémoire{Enter}')
    expect(chips()).toEqual(['Mémoire', 'Chimie organique', 'IA & agents'])
    await user.click(screen.getByRole('button', { name: 'Valider les tags' }))
    expect(onDone).toHaveBeenCalledWith(['Mémoire', 'Chimie organique', 'IA & agents'])
  })

  it('5 tags au plus : un 6e est refusé avec un message', async () => {
    const { user } = renderScreen(['A1', 'A2', 'A3', 'A4', 'A5'])
    await user.click(row('Culture'))
    expect(screen.getByRole('alert').textContent).toBe('5 tags au maximum par carte.')
    expect(chips()).toHaveLength(5)
    expect(row('Culture').getAttribute('aria-disabled')).toBe('true')
  })

  it('nom trop long refusé, rien d’ajouté', async () => {
    const { user } = renderScreen()
    await user.type(search(), 'x'.repeat(41))
    await user.click(screen.getByRole('button', { name: /^Créer/ }))
    expect(screen.getByRole('alert').textContent).toMatch(/^Nom de tag trop long/)
    expect(chips()).toEqual(['IA & agents'])
  })

  it('✕ sans modification ferme ; avec modifications, confirmation (continuer / abandonner)', async () => {
    const { user, onCancel } = renderScreen()
    await user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    cleanup()

    const second = renderScreen()
    await second.user.click(row('Culture'))
    await second.user.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    await second.user.click(screen.getByRole('button', { name: 'Continuer à modifier' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(chips()).toEqual(['IA & agents', 'Culture'])
    await second.user.click(screen.getByRole('button', { name: 'Fermer' }))
    await second.user.click(within(screen.getByRole('alertdialog')).getAllByRole('button').find(b => b.textContent !== 'Continuer à modifier')!)
    expect(second.onCancel).toHaveBeenCalledTimes(1)
    expect(second.onDone).not.toHaveBeenCalled()
  })
})
