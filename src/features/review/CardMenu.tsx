import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmDialog } from '../../components/SheetBar'

/** Position sous le bouton ⋯, bord droit aligné sur lui (Paper « Révision · Menu de la carte »). */
function belowButton(anchor: DOMRect): CSSProperties {
  return { top: anchor.bottom + 6, right: Math.max(12, window.innerWidth - anchor.right) }
}

interface Props {
  anchor: DOMRect
  onEdit(): void
  onDelete(): void
  onClose(): void
}

/**
 * Menu ⋯ de la carte (#73) : « Modifier » (crayon) et « Supprimer » (rouge, corbeille). Fond presque opaque
 * (`--glass-solid`, texte et rouge ≥ 4,5:1), aucun voile, rendu dans <body> : jamais dans la carte floutée (pas de
 * flou imbriqué), et un tap à côté tombe sur la couche transparente (ferme le menu) au lieu de révéler ou noter la
 * carte. Échap / Tab ferment ; flèches, Début, Fin parcourent les choix. Focus sur le 1er choix, rendu au ⋯ ensuite.
 */
export function CardMenu({ anchor, onEdit, onDelete, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(onClose)
  useEffect(() => { latest.current = onClose })
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); latest.current() }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); if (opener?.isConnected) opener.focus() }
  }, [])

  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next = { ArrowDown: i + 1, ArrowUp: i - 1 + items.length, Home: 0, End: items.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    items[next % items.length]?.focus()
  }

  const row = 'flex h-[50px] w-full cursor-pointer items-center justify-between px-[18px] text-start text-[17px] leading-[22px] font-medium outline-none hover:bg-black/5 focus-visible:bg-black/5 active:bg-black/10 dark:hover:bg-white/8 dark:focus-visible:bg-white/8 dark:active:bg-white/12'
  const icon = { 'aria-hidden': true, viewBox: '0 0 24 24', className: 'size-5 shrink-0', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div aria-hidden="true" className="absolute inset-0" onClick={onClose} />
      <div
        ref={box}
        role="menu"
        aria-label="Actions de la carte"
        onKeyDown={move}
        style={{ backgroundColor: 'var(--glass-solid)', ...belowButton(anchor) }}
        className="glass absolute w-[212px] overflow-hidden rounded-[22px] text-black dark:text-white"
      >
        <button type="button" role="menuitem" tabIndex={-1} onClick={onEdit} className={row}>
          Modifier
          <svg {...icon}><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>
        </button>
        <div aria-hidden="true" className="h-px bg-black/10 dark:bg-white/12" />
        <button type="button" role="menuitem" tabIndex={-1} onClick={onDelete} className={`${row} text-again`}>
          Supprimer
          <svg {...icon}><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></svg>
        </button>
      </div>
    </div>,
    document.body,
  )
}

/** « Supprimer » du menu (#73) : confirmation au même endroit que le menu ; focus sur « Annuler ». */
export function DeleteCardDialog({ anchor, onConfirm, onCancel }: { anchor: DOMRect; onConfirm(): void; onCancel(): void }) {
  return (
    <ConfirmDialog
      message="Supprimer cette carte ?"
      confirmLabel="Supprimer"
      cancelLabel="Annuler"
      onConfirm={onConfirm}
      onCancel={onCancel}
      className="w-[212px]"
      style={belowButton(anchor)}
    />
  )
}
