import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, fireEvent } from '@testing-library/react'
import { useReviewKeys } from './useReviewKeys'

const session = (revealed: boolean, status: 'reviewing' | 'done' = 'reviewing') =>
  ({ status, revealed, reveal: vi.fn(), rate: vi.fn() })

describe('useReviewKeys', () => {
  it('Espace et Entrée révèlent la réponse', () => {
    const s = session(false)
    renderHook(() => useReviewKeys(s))
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(s.reveal).toHaveBeenCalledTimes(2)
    expect(s.rate).not.toHaveBeenCalled()
  })
  it('1 / 2 / 3 notent une fois la réponse révélée', () => {
    const s = session(true)
    renderHook(() => useReviewKeys(s))
    for (const key of ['1', '2', '3']) fireEvent.keyDown(window, { key })
    expect(s.rate.mock.calls).toEqual([[1], [2], [3]])
  })
  it('menu ⋯ ouvert (role="menu") ou « Modifier la carte » affichée (#73) : aucune touche ne révèle ni ne note', () => {
    const s = session(false)
    renderHook(() => useReviewKeys(s))
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    document.body.appendChild(menu)
    fireEvent.keyDown(window, { key: ' ' })
    menu.remove()
    expect(s.reveal).not.toHaveBeenCalled()
    const editing = session(true)
    renderHook(() => useReviewKeys(editing, true))
    fireEvent.keyDown(window, { key: '1' })
    expect(editing.rate).not.toHaveBeenCalled()
  })
  it('ignore les touches hors session et avec modificateur', () => {
    const done = session(true, 'done')
    renderHook(() => useReviewKeys(done))
    fireEvent.keyDown(window, { key: '1' })
    expect(done.rate).not.toHaveBeenCalled()
    const s = session(true)
    renderHook(() => useReviewKeys(s))
    fireEvent.keyDown(window, { key: '1', metaKey: true })
    expect(s.rate).not.toHaveBeenCalled()
  })

  describe('fenêtre ouverte (#82) : Entrée / Espace / 1 / 2 / 3 n’agissent pas sur la carte', () => {
    afterEach(() => { document.body.innerHTML = '' })
    const openDialog = () => {
      const dialog = document.createElement('div')
      dialog.setAttribute('role', 'dialog')
      const btn = document.createElement('button')
      btn.textContent = 'Se déconnecter'
      dialog.append(btn)
      document.body.append(dialog)
      return btn
    }

    it('focus dans la fenêtre : rien n’est révélé ni noté, Entrée reste au bouton (pas de preventDefault)', () => {
      const hidden = session(false)
      const shown = session(true)
      renderHook(() => useReviewKeys(hidden))
      renderHook(() => useReviewKeys(shown))
      const btn = openDialog()
      expect(fireEvent.keyDown(btn, { key: 'Enter' })).toBe(true) // non annulé : le bouton reçoit son clic
      fireEvent.keyDown(btn, { key: ' ' })
      for (const key of ['1', '2', '3']) fireEvent.keyDown(btn, { key })
      expect(hidden.reveal).not.toHaveBeenCalled()
      expect(shown.rate).not.toHaveBeenCalled()
    })

    it('fenêtre ouverte mais focus resté sur la page (Safari/iOS) : rien non plus', () => {
      const s = session(true)
      renderHook(() => useReviewKeys(s))
      openDialog()
      fireEvent.keyDown(window, { key: '1' })
      expect(s.rate).not.toHaveBeenCalled()
    })
  })
})
