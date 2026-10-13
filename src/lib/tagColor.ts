import type { CSSProperties } from 'react'

/** Couleur d'un tag pour le CSS (`.tag-chip`, `.tag-pill`) : `--chip-fg`, pris du jeton `--tag-<color>-fg` d'index.css. */
export const tagColorVars = (color: string) => ({ '--chip-fg': `var(--tag-${color}-fg)` }) as CSSProperties
