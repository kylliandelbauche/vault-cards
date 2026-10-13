import type { CSSProperties } from 'react'

/**
 * Couleur d'un tag pour le CSS (`.tag-chip`, `.tag-pill`) : fond teinté `--chip-bg` et texte `--chip-fg`,
 * pris des jetons `--tag-<color>-bg|fg` d'index.css (clair et sombre).
 */
export const tagColorVars = (color: string) =>
  ({ '--chip-bg': `var(--tag-${color}-bg)`, '--chip-fg': `var(--tag-${color}-fg)` }) as CSSProperties
