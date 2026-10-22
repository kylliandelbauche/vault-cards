import { useEffect, useId, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { GlassButton } from './GlassButton'
import { EDGES, IconButton } from './TopBar'

interface SheetBarProps {
  title: string
  /** ✕ : fermer (l'écran décide s'il faut confirmer l'abandon des modifications). */
  onClose(): void
  /** ✓ bleu (seule action bleue de l'écran), gris quand désactivé ; sans lui, un emplacement vide garde le titre centré. */
  onConfirm?(): void
  confirmLabel?: string
  confirmDisabled?: boolean
}

/**
 * Barre des fenêtres de saisie (#81, Paper « Source · Texte », « Carte · Modifier ») : ✕ / titre centré / ✓ bleu.
 * Même conteneur en verre que TopBar (mêmes marges, même hauteur) ; le ✓ est posé sur la barre (`on-glass`) : pas de
 * flou imbriqué. Cibles de 44 px.
 */
export function SheetBar({ title, onClose, onConfirm, confirmLabel = 'Enregistrer', confirmDisabled }: SheetBarProps) {
  return (
    <header className={`sticky top-0 z-20 shrink-0 pt-[max(12px,var(--k-safe-area-top))] pb-2 ${EDGES}`}>
      <div className="glass mx-auto flex max-w-xl items-center gap-3 rounded-[26px] px-4 py-2.5">
        <IconButton label="Fermer" onClick={onClose} className="-ms-2.5">
          <path d="M6 6l12 12M18 6L6 18" strokeWidth="2.4" />
        </IconButton>
        <h1 className="min-w-0 flex-1 truncate text-center text-[17px] leading-tight font-semibold text-black dark:text-white">{title}</h1>
        {onConfirm ? (
          <GlassButton
            tone={confirmDisabled ? 'neutral' : 'new'}
            aria-label={confirmLabel}
            disabled={confirmDisabled}
            onClick={onConfirm}
            className="on-glass -my-2 -me-2.5 flex size-11 shrink-0 items-center justify-center rounded-full text-new disabled:text-label-2 disabled:opacity-70"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </GlassButton>
        ) : <span aria-hidden="true" className="-my-2 -me-2.5 size-11 shrink-0" />}
      </div>
    </header>
  )
}

/**
 * ✕ avec des modifications (Paper « Ajouter des tags · 4 ») : petite fenêtre sous le ✕, voile sombre derrière.
 * Échap ou tap sur le voile = continuer à modifier ; focus sur « Continuer à modifier » (le choix sans perte).
 */
export function DiscardDialog({ onDiscard, onContinue }: { onDiscard(): void; onContinue(): void }) {
  return (
    <ConfirmDialog
      message="Tes modifications ne seront pas enregistrées."
      confirmLabel="Ignorer les modifications"
      cancelLabel="Continuer à modifier"
      onConfirm={onDiscard}
      onCancel={onContinue}
      className="start-[max(16px,env(safe-area-inset-left))] top-[calc(max(12px,env(safe-area-inset-top))+68px)] w-[270px]"
    />
  )
}

interface ConfirmDialogProps {
  message: string
  /** Choix destructeur, en rouge. */
  confirmLabel: string
  /** Choix sans perte, en gras, qui reçoit le focus. */
  cancelLabel: string
  onConfirm(): void
  onCancel(): void
  /** Position et largeur de la fenêtre (classes `absolute`), ou `style` pour une position calculée. */
  className?: string
  style?: CSSProperties
}

/**
 * Petite fenêtre de confirmation (✕ avec modifications, suppression d'une carte #73) : voile sombre, fond presque
 * opaque (`--glass-solid`) : le rouge reste ≥ 4,5:1 malgré le voile. Échap ou tap sur le voile = annuler. Rendue dans
 * <body> (au-dessus des barres `sticky`, jamais dans une surface floutée : pas de flou imbriqué).
 */
export function ConfirmDialog({ message, confirmLabel, cancelLabel, onConfirm, onCancel, className = '', style }: ConfirmDialogProps) {
  const keep = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const latest = useRef(onCancel)
  useEffect(() => { latest.current = onCancel })
  // Monté une seule fois : focus posé sur le choix sans perte, Échap, piège de Tab dans la fenêtre, puis focus
  // rendu à l'élément d'origine à la fermeture.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    keep.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { latest.current(); return }
      if (e.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll<HTMLElement>('button')]
      const i = items.indexOf(document.activeElement as HTMLElement)
      e.preventDefault()
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus() }
  }, [])
  const id = useId()
  const row = 'flex h-[50px] w-full cursor-pointer items-center border-t border-black/10 px-[18px] text-start text-[17px] leading-[22px] hover:bg-black/5 active:bg-black/10 dark:border-white/12 dark:hover:bg-white/8 dark:active:bg-white/12'
  return createPortal(
    <div className="fixed inset-0 z-40">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={id}
        style={{ backgroundColor: 'var(--glass-solid)', ...style }}
        className={`glass absolute overflow-hidden rounded-[22px] text-black dark:text-white ${className}`}
      >
        <p id={id} className="px-[18px] pt-3.5 pb-3 text-[13px] leading-[18px] text-label-2">{message}</p>
        <button type="button" onClick={onConfirm} className={`${row} font-medium text-again`}>{confirmLabel}</button>
        <button type="button" ref={keep} onClick={onCancel} className={`${row} font-semibold`}>{cancelLabel}</button>
      </div>
    </div>,
    document.body,
  )
}
