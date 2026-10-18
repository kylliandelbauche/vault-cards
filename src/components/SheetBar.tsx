import { useEffect, useRef } from 'react'
import { GlassButton } from './GlassButton'
import { EDGES, IconButton } from './TopBar'

interface SheetBarProps {
  title: string
  /** ✕ : fermer (l'écran décide s'il faut confirmer l'abandon des modifications). */
  onClose(): void
  /** ✓ bleu (seule action bleue de l'écran) ; sans lui, un emplacement vide garde le titre centré. */
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
            tone="new"
            aria-label={confirmLabel}
            disabled={confirmDisabled}
            onClick={onConfirm}
            className="on-glass -my-2 -me-2.5 flex size-11 shrink-0 items-center justify-center rounded-full text-new disabled:opacity-60"
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
 * Fond presque opaque (`--glass-solid`) : le rouge reste ≥ 4,5:1 malgré le voile. Échap ou tap sur le voile =
 * continuer à modifier. Le focus va sur « Continuer à modifier » (le choix sans perte).
 */
export function DiscardDialog({ onDiscard, onContinue }: { onDiscard(): void; onContinue(): void }) {
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    keep.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onContinue() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onContinue])
  const row = 'flex h-[50px] w-full items-center border-t border-black/10 px-[18px] text-start text-[17px] leading-[22px] hover:bg-black/5 active:bg-black/10 dark:border-white/12 dark:hover:bg-white/8 dark:active:bg-white/12'
  return (
    <div className="fixed inset-0 z-40">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onContinue} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-message"
        style={{ backgroundColor: 'var(--glass-solid)' }}
        className="glass absolute start-[max(16px,var(--k-safe-area-left))] top-[calc(max(12px,var(--k-safe-area-top))+68px)] w-[270px] overflow-hidden rounded-[22px] text-black dark:text-white"
      >
        <p id="discard-message" className="px-[18px] pt-3.5 pb-3 text-[13px] leading-[18px] text-label-2">
          Tes modifications ne seront pas enregistrées.
        </p>
        <button type="button" onClick={onDiscard} className={`${row} font-medium text-again`}>Ignorer les modifications</button>
        <button type="button" ref={keep} onClick={onContinue} className={`${row} font-semibold`}>Continuer à modifier</button>
      </div>
    </div>
  )
}
