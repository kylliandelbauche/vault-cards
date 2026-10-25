import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BarActionsProvider, BarTitle, TopBar } from './TopBar'

afterEach(cleanup)

const withActions = (search = true, profile = true) => {
  const onSearch = vi.fn()
  const onProfile = vi.fn()
  const r = render(
    <BarActionsProvider value={{ onProfile, onSearch }}>
      <TopBar onBack={vi.fn()} backLabel="Accueil" search={search} profile={profile}><BarTitle title="Mes tags" subtitle="10 cartes à revoir" /></TopBar>
    </BarActionsProvider>,
  )
  return { ...r, onProfile, onSearch, user: userEvent.setup() }
}

describe('TopBar (#82)', () => {
  it('accueil (sans onBack) : pas de flèche, le titre ouvre la ligne ; pas de bandeau en verre', () => {
    const { container } = render(<TopBar><BarTitle title="Vault Cards" large /></TopBar>)
    expect(screen.queryByRole('button')).toBeNull()
    const header = container.querySelector('header')!
    expect(header.querySelector('.glass, .glass-card')).toBeNull()
    expect(header.className.split(' ')).toEqual(expect.arrayContaining(['bar-fade', 'sticky']))
    expect(header.querySelector('p')?.className).toContain('text-[22px]')
  })

  it('écran secondaire : flèche ronde 48 px en verre (sans flou propre) en tête, nommée par l’écran de destination', async () => {
    const onBack = vi.fn()
    render(<TopBar onBack={onBack} backLabel="Mes tags"><BarTitle title="IA & agents" subtitle="Carte 3 sur 10" /></TopBar>)
    const btn = screen.getByRole('button', { name: 'Mes tags' })
    expect(btn.className.split(' ')).toEqual(expect.arrayContaining(['glass-btn', 'on-glass', 'size-12', 'rounded-full']))
    expect(btn.nextElementSibling?.textContent).toBe('IA & agentsCarte 3 sur 10')
    await userEvent.setup().click(btn)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('titre + petit sous-titre sur une ligne, jamais de gros titre dessous ; <h1> si demandé', () => {
    render(<TopBar><BarTitle title="Mes tags" subtitle="10 cartes à revoir" heading /></TopBar>)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Mes tags')
    expect(h1.className).toContain('text-[17px]')
    expect(h1.nextElementSibling?.textContent).toBe('10 cartes à revoir')
    expect(h1.nextElementSibling?.className).toContain('text-[13px]')
  })

  it('sans fournisseur d’actions : ni Recherche ni Profil', () => {
    render(<TopBar onBack={vi.fn()}><BarTitle title="Mes tags" /></TopBar>)
    expect(screen.queryByRole('button', { name: 'Rechercher' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Profil' })).toBeNull()
  })

  it('Recherche et Profil à droite, ronds 48 px ; aucun bouton Déconnexion dans la barre', () => {
    const { container } = withActions()
    const buttons = within(container.querySelector('header')!).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Accueil', 'Rechercher', 'Profil'])
    for (const b of buttons) expect(b.className.split(' ')).toEqual(expect.arrayContaining(['size-12', 'on-glass']))
    expect(screen.queryByRole('button', { name: /Déconnexion|Se déconnecter/ })).toBeNull()
  })

  it('Recherche (#80) : la loupe ouvre « Mes cartes » (onSearch), sans fenêtre', async () => {
    const { user, onSearch } = withActions()
    const search = screen.getByRole('button', { name: 'Rechercher' })
    expect(search.hasAttribute('aria-haspopup')).toBe(false)
    await user.click(search)
    expect(onSearch).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('search={false} (« Mes cartes ») : pas de loupe, Profil reste', () => {
    const { container } = withActions(false)
    const buttons = within(container.querySelector('header')!).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Accueil', 'Profil'])
  })

  it('Profil (#83) : le bouton ouvre l’écran Profil (onProfile), sans petite fenêtre', async () => {
    const { user, onProfile } = withActions()
    const profile = screen.getByRole('button', { name: 'Profil' })
    expect(profile.hasAttribute('aria-haspopup')).toBe(false)
    await user.click(profile)
    expect(onProfile).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('profile={false} (écran Profil) ou sans onProfile : pas de bouton Profil', () => {
    const { container, unmount } = withActions(false, false)
    expect(within(container.querySelector('header')!).queryByRole('button', { name: 'Profil' })).toBeNull()
    unmount()
    render(<BarActionsProvider value={{ onSearch: vi.fn() }}><TopBar><BarTitle title="Vault Cards" /></TopBar></BarActionsProvider>)
    expect(screen.queryByRole('button', { name: 'Profil' })).toBeNull()
  })
})

describe('SyncBadge (accueil)', () => {
  it('texte opaque, point animé seulement si les animations sont permises', () => {
    render(<TopBar><BarTitle title="Vault Cards" sync="syncing" large /></TopBar>)
    const badge = screen.getByRole('status')
    expect(badge.textContent).toBe('Synchronisation…')
    expect(badge.className).not.toMatch(/opacity/)
    const dot = badge.querySelector('[aria-hidden]')!
    expect(dot.className).toMatch(/motion-safe:animate-pulse/)
    expect(dot.className.split(' ')).not.toContain('animate-pulse')
  })
})
