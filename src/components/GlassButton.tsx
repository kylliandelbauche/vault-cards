import { Glass } from 'konsta/react'
import type { ButtonHTMLAttributes, ComponentType } from 'react'

/** Teinte du verre : bleu (action principale), rouge / ambre / vert (notes), neutre (action secondaire). */
export type GlassTone = 'new' | 'again' | 'hard' | 'good' | 'neutral'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  tone: GlassTone
  type?: 'button' | 'submit'
}

/** Bouton principal (verre bleu) : 56 px de haut (cible ≥ 44 px), pleine largeur, libellé 17 px semi-gras. */
export const GLASS_PRIMARY = 'flex h-14 w-full items-center justify-center rounded-full px-5 text-[17px] font-semibold'

// Les types de Konsta décrivent `Glass` comme un <div> ; avec component="button", les attributs
// de bouton (type, disabled) sont bien transmis au DOM.
const GlassEl = Glass as unknown as ComponentType<
  ButtonHTMLAttributes<HTMLButtonElement> & { component: 'button'; colors: { bgIos: string; shadowIos: string } }
>

/**
 * Bouton en verre coloré indépendant (#39), sur le composant `Glass` de Konsta : il apporte le reflet
 * iOS 26 (lumière qui suit le doigt, léger grossissement à l'appui, coupés sous « Réduire les animations »
 * via `iosHoverHighlight` de l'App). Le matériau (teinte, flou modéré, reflet de bord, `contain`,
 * `touch-action`, replis opaques) vient de `.glass-btn` dans index.css : hors @layer, ces règles
 * l'emportent sur les utilitaires posés par `Glass` (`backdrop-blur-lg`, `touch-none`).
 */
export function GlassButton({ tone, type = 'button', className = '', ...rest }: Props) {
  return (
    <GlassEl
      component="button"
      type={type}
      colors={{ bgIos: `glass-btn-${tone}`, shadowIos: '' }}
      className={`glass-btn ${className}`}
      {...rest}
    />
  )
}
