import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BarTitle, TopBar } from './TopBar'

afterEach(cleanup)

describe('TopBar', () => {
  it('sans onBack : emplacement invisible de la taille du chevron (le titre reste au même endroit)', () => {
    const { container } = render(<TopBar><BarTitle title="Vault Cards" /></TopBar>)
    const slot = container.querySelector('[data-back-slot]')!
    expect(slot.getAttribute('aria-hidden')).toBe('true')
    expect(slot.className.split(' ')).toEqual(expect.arrayContaining(['size-11', '-ms-2.5', '-my-2']))
    expect(screen.queryByRole('button')).toBeNull()
    expect(slot.nextElementSibling?.textContent).toBe('Vault Cards')
  })

  it('avec onBack : chevron de même taille et mêmes marges, nommé par l’écran de destination', async () => {
    const onBack = vi.fn()
    const { container } = render(<TopBar onBack={onBack} backLabel="Mes tags"><BarTitle title="Vault Cards" /></TopBar>)
    const btn = screen.getByRole('button', { name: 'Mes tags' })
    expect(btn.className.split(' ')).toEqual(expect.arrayContaining(['size-11', '-ms-2.5', '-my-2']))
    expect(container.querySelector('[data-back-slot]')).toBeNull()
    expect(btn.nextElementSibling?.textContent).toBe('Vault Cards')
    await userEvent.setup().click(btn)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
