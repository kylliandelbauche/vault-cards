import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App as KApp } from 'konsta/react'
import { GlassButton } from './GlassButton'

afterEach(cleanup)

describe('GlassButton', () => {
  it('rend un vrai <button type="button"> en verre teinté, cliquable', async () => {
    const onClick = vi.fn()
    render(<KApp theme="ios"><GlassButton tone="good" onClick={onClick}>Très bien</GlassButton></KApp>)
    const btn = screen.getByRole('button', { name: 'Très bien' })
    expect(btn.getAttribute('type')).toBe('button')
    expect(btn.className.split(' ')).toEqual(expect.arrayContaining(['k-glass', 'glass-btn', 'glass-btn-good']))
    // Les ombres internes de Konsta (coûteuses) ne sont pas posées : le matériau vient de .glass-btn.
    expect(btn.className).not.toMatch(/shadow-ios/)
    await userEvent.setup().click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('transmet type="submit" et disabled', () => {
    render(<KApp theme="ios"><GlassButton tone="new" type="submit" disabled>Se connecter</GlassButton></KApp>)
    const btn = screen.getByRole('button', { name: 'Se connecter' }) as HTMLButtonElement
    expect(btn.type).toBe('submit')
    expect(btn.disabled).toBe(true)
  })

  it('reflet Konsta à l’appui, coupé quand l’App le désactive (« Réduire les animations »)', () => {
    const { unmount } = render(<KApp theme="ios"><GlassButton tone="new">A</GlassButton></KApp>)
    let btn = screen.getByRole('button', { name: 'A' })
    fireEvent.pointerEnter(btn, { pointerType: 'touch' })
    expect(btn.querySelector('span.rounded-\\[inherit\\]')).toBeTruthy()
    unmount()

    render(<KApp theme="ios" iosHoverHighlight={false}><GlassButton tone="new">A</GlassButton></KApp>)
    btn = screen.getByRole('button', { name: 'A' })
    fireEvent.pointerEnter(btn, { pointerType: 'touch' })
    expect(btn.querySelector('span')).toBeNull()
    expect(btn.style.scale).toBe('')
  })
})
