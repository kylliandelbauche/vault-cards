import { memo, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { Card } from '../../lib/types'

/** Course du glissement ouvert : bouton « Supprimer » (80 px) + 12 px d'écart (Paper « Mes cartes · 4 carte glissée »). */
export const REVEAL = 92
/** Mouvement minimal avant de choisir l'axe : en dessous, c'est un tap. */
const SLOP = 8
/** Élasticité au-delà de la course. */
const OVERDRAG = 24

const TRASH = <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>

interface Props {
  card: Card
  /** Glissée (« Supprimer » visible) : une seule à la fois, gérée par la liste. */
  open: boolean
  onOpenChange(id: string, open: boolean): void
  onEdit(card: Card): void
  /** Demande de suppression (confirmation d'abord) ; `anchor` : la carte, pour placer la fenêtre. */
  onDelete(card: Card, anchor: DOMRect): void
}

/**
 * Carte de « Mes cartes » (#80, Paper « 1 liste », « 4 carte glissée ») : question, réponse, tags. Tap → modifier.
 * Glisser vers la gauche (doigt ou stylet) révèle « Supprimer » en rouge, fait main avec les pointer events :
 * `touch-action: pan-y` laisse le défilement vertical au navigateur (il annule alors le geste : pointercancel) ; l'axe
 * n'est choisi qu'après 8 px, et la carte suit le doigt sans rendu React (transform posé directement).
 * Souris / clavier (Mac) : corbeille ronde de 44 px, visible au survol ou au focus (pointeur fin seulement).
 * Pas de flou propre (`list-card`) : des centaines de cartes floutées ne défileraient pas à 60 i/s.
 */
export const CardRow = memo(function CardRow({ card, open, onOpenChange, onEdit, onDelete }: Props) {
  const row = useRef<HTMLLIElement>(null)
  const face = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; base: number; dx: number; horizontal: boolean } | null>(null)
  // Un glissement vient d'avoir lieu : le clic qui peut suivre n'ouvre pas la modification.
  const swiped = useRef(false)
  const [dragging, setDragging] = useState(false)

  const place = (x: number) => { if (face.current) face.current.style.transform = x ? `translate3d(${x}px,0,0)` : '' }

  // Ouverte : un tap n'importe où ailleurs la referme (comme Mail).
  useEffect(() => {
    if (!open) return
    const close = (e: globalThis.PointerEvent) => { if (!row.current?.contains(e.target as Node)) onOpenChange(card.id, false) }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open, card.id, onOpenChange])

  const down = (e: PointerEvent<HTMLDivElement>) => {
    swiped.current = false
    if (e.pointerType === 'mouse' || !e.isPrimary) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, base: open ? -REVEAL : 0, dx: 0, horizontal: false }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x
    if (!d.horizontal) {
      const dy = e.clientY - d.y
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
      if (Math.abs(dy) >= Math.abs(dx)) { drag.current = null; return } // défilement : au navigateur
      d.horizontal = true
      swiped.current = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
      setDragging(true)
    }
    d.dx = dx
    place(Math.min(0, Math.max(-REVEAL - OVERDRAG, d.base + dx)))
  }
  const end = (commit: boolean) => (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.horizontal) return
    const next = commit ? d.base + d.dx < -REVEAL / 2 : open
    place(next ? -REVEAL : 0)
    setDragging(false)
    if (next !== open) onOpenChange(card.id, next)
  }

  const edit = () => {
    if (swiped.current) { swiped.current = false; return }
    if (open) { onOpenChange(card.id, false); return }
    onEdit(card)
  }
  const askDelete = () => { if (row.current) onDelete(card, row.current.getBoundingClientRect()) }

  return (
    <li ref={row} className="relative">
      {(open || dragging) && (
        <button
          type="button"
          onClick={askDelete}
          className="delete-action absolute inset-y-0 end-0 flex w-20 flex-col items-center justify-center gap-1.5 rounded-[22px] text-[13px] leading-4 font-semibold"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{TRASH}</svg>
          Supprimer
        </button>
      )}
      <div
        ref={face}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end(true)}
        onPointerCancel={end(false)}
        style={open ? { transform: `translate3d(${-REVEAL}px,0,0)` } : undefined}
        className={`list-card group relative touch-pan-y rounded-[20px] select-none ${dragging ? '' : 'motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out'}`}
      >
        <button type="button" onClick={edit} className="flex w-full flex-col gap-1 rounded-[20px] py-3.5 ps-4 pe-3 text-start pointer-fine:pe-14">
          <span className="line-clamp-3 text-[16px] leading-[21px] font-semibold text-black dark:text-white">{card.front}</span>
          <span className="line-clamp-2 text-[14px] leading-[19px] text-label-2">{card.back}</span>
          {card.tags.length > 0 && (
            <span className="flex flex-wrap gap-1.5 pt-1.5">
              {card.tags.map(t => (
                <span key={t} className="tag-pill flex h-7 items-center rounded-full px-3 text-[13px] leading-4 font-medium">{t}</span>
              ))}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label="Supprimer la carte"
          onClick={askDelete}
          className="absolute end-1.5 top-1.5 hidden size-11 items-center justify-center rounded-full text-again opacity-0 group-hover:opacity-100 hover:bg-black/5 focus-visible:opacity-100 pointer-fine:flex dark:hover:bg-white/10"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{TRASH}</svg>
        </button>
      </div>
    </li>
  )
})
