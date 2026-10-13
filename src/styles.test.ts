/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// Lu depuis le disque : Vitest remplace les imports CSS (même `?raw`) par une chaîne vide.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

/** Corps du premier bloc `{ … }` (imbrication comprise) qui suit `prelude`. */
function block(prelude: string): string {
  const start = css.indexOf(prelude)
  expect(start, `bloc introuvable : ${prelude}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  throw new Error('bloc non fermé')
}

/** CSS sans commentaires (les commentaires citent ce qu'on s'interdit). */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

describe('index.css : verre et repli (#19, #39)', () => {
  it('le verre floute avec et sans préfixe WebKit', () => {
    const glass = block('.glass,\n.glass-card {')
    expect(glass).toMatch(/-webkit-backdrop-filter:\s*blur/)
    expect(glass).toMatch(/[^-]backdrop-filter:\s*blur/)
  })

  it('seul repli conservé : verre opaque (barres, carte, boutons) sans backdrop-filter', () => {
    const b = block('@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))')
    expect(b).toMatch(/\.glass,\s*\.glass-card\s*\{[^}]*background-color:\s*var\(--glass-solid\)/)
    expect(b).toMatch(/\.glass-btn\s*\{[^}]*background-color:\s*var\(--glass-solid\);[^}]*background-image:\s*none/)
  })

  it('full liquid glass (#39, demande de Kyllian) : replis Réduire la transparence / Augmenter le contraste reportés', () => {
    expect(code).not.toMatch(/prefers-reduced-transparency/)
    expect(code).not.toMatch(/prefers-contrast/)
  })

  it('boutons en verre : verre neutre translucide + lueur et liseré colorés, en clair et en sombre', () => {
    for (const root of [':root {', '.dark {']) {
      expect(block(root)).toMatch(/--glass-btn-bg:\s*rgb\([^)]*\/ 0\.[3-6]\d*\)/)
      for (const tone of ['new', 'again', 'hard', 'good']) {
        expect(block(root)).toMatch(new RegExp(`--glow-${tone}:\\s*rgb\\([^)]*/ 0\\.\\d+\\)`))
        expect(block(root)).toContain(`--rim-${tone}:`)
      }
      for (const tone of ['again', 'hard', 'good']) expect(block(root)).toContain(`--${tone}-glass:`)
    }
    for (const tone of ['new', 'again', 'hard', 'good']) {
      const rule = block(`.glass-btn-${tone} {`)
      expect(rule).toContain(`var(--glow-${tone})`)
      expect(rule).toContain(`var(--rim-${tone})`)
    }
  })

  it('survol Liquid Glass : souris / trackpad seulement, éclaircissement en opacity sous le texte, soulèvement en scale', () => {
    const hover = block('@media (hover: hover) and (pointer: fine) {')
    expect(hover).toMatch(/\.glass-btn:hover:not\(:disabled\):not\(\[aria-disabled='true'\]\)::before\s*\{[^}]*opacity:\s*1/)
    const before = block('.glass-btn::before {')
    expect(before).toMatch(/opacity:\s*0/)
    expect(before).toMatch(/z-index:\s*-1/)
    expect(before).toMatch(/pointer-events:\s*none/)
    const motion = block('@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')
    expect(motion).toMatch(/scale:\s*1\.02/)
    expect(motion).toMatch(/transition:\s*opacity 1\d0ms ease-out/)
    // Aucun :hover hors de ces blocs (pas d'effet de survol collant au doigt).
    expect(code.replace(/@media \(hover: hover\)[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '')).not.toMatch(/:hover/)
  })

  it('notes plus carrées si la hauteur le permet ; zone d’action remontée sur desktop seulement', () => {
    expect(block('@media (min-height: 740px)')).toMatch(/\.rating-btn\s*\{[^}]*width:\s*100%;[^}]*aspect-ratio:\s*1;[^}]*max-height:\s*116px/)
    expect(block('@media (hover: hover) and (pointer: fine), (min-width: 768px) and (min-height: 700px)')).toMatch(/\.action-dock\s*\{[^}]*padding-bottom:\s*max\(32px/)
  })

  it('« Réduire les animations » : aucune transition sur les boutons en verre', () => {
    expect(block('@media (prefers-reduced-motion: reduce)')).toMatch(/\.glass-btn\s*\{[^}]*transition-property:\s*none/)
  })

  it('reflet Konsta adouci sur le verre teinté (50 % par défaut rendrait le libellé illisible)', () => {
    expect(block('.glass-btn {')).toMatch(/--color-ios-hover-highlight:\s*var\(--glass-btn-highlight\)/)
  })

  it('focus visible sur les boutons Konsta (qui posent focus:outline-none)', () => {
    expect(block('.k-button:focus-visible')).toMatch(/outline:\s*2px solid/)
    expect(css).toMatch(/\.glass-btn:focus-visible,[\s\S]*?\{\s*outline:\s*2px solid/)
  })

  it('variantes claire et sombre du fond et du verre', () => {
    for (const token of ['--bg-base', '--glass-bg', '--glass-solid', '--glass-card-bg']) {
      expect(block(':root {')).toContain(`${token}:`)
      expect(block('.dark {')).toContain(`${token}:`)
    }
  })
})


describe('index.css : garde-fous de performance (#19)', () => {
  it('flou modéré (≤ 20 px) et zone repeinte limitée sur le verre', () => {
    const glass = block('.glass,\n.glass-card {')
    for (const m of glass.matchAll(/blur\((\d+)px\)/g)) expect(Number(m[1])).toBeLessThanOrEqual(20)
    expect(glass).toMatch(/contain:\s*layout paint/)
    expect(code).not.toMatch(/will-change/)
  })

  it('boutons en verre : flou plus léger (≤ 16 px), zone repeinte limitée, défilement et tap natifs', () => {
    const btn = block('.glass-btn {')
    const blurs = [...btn.matchAll(/blur\((\d+)px\)/g)].map(m => Number(m[1]))
    expect(blurs.length).toBe(2)
    for (const b of blurs) expect(b).toBeLessThanOrEqual(16)
    expect(btn).toMatch(/contain:\s*layout paint/)
    // Remplace le touch-none de Konsta : la page défile même si le geste commence sur un bouton.
    expect(btn).toMatch(/touch-action:\s*manipulation/)
    // Seul `scale` (reflet Konsta) peut être animé : jamais l'ombre, le fond ou le flou.
    expect(btn).toMatch(/transition-property:\s*scale;/)
    expect(code).not.toMatch(/transition(-property)?:\s*(all|background|backdrop)/)
    // L'ombre ne s'anime qu'au survol à la souris (desktop), jamais au doigt.
    const transitions = [...code.matchAll(/transition:[^;]*box-shadow/g)]
    expect(transitions).toHaveLength(1)
    expect(block('@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)')).toMatch(/transition:[^;]*box-shadow/)
  })

  it('fond : un calque fixe sans background-attachment: fixed ni filtre', () => {
    const bg = block('.app-backdrop {')
    expect(bg).toMatch(/position:\s*fixed/)
    expect(code).not.toMatch(/background-attachment:\s*fixed/)
    expect(bg).not.toMatch(/filter/)
  })

  it('progression sans transition de largeur sous le verre', () => {
    expect(block('.k-progressbar > * {')).toMatch(/transition:\s*none/)
  })
})

describe('index.css : pastilles de tags de l’accueil (#53)', () => {
  it('tag sans carte : jetons clair et sombre, pas de curseur main (aria-disabled), focus visible', () => {
    for (const root of [':root {', '.dark {']) {
      expect(block(root)).toMatch(/--tag-empty-fg:\s*#[0-9a-f]{6}/i)
    }
    expect(code).toMatch(/button:not\(:disabled\):not\(\[aria-disabled='true'\]\)/)
    expect(code).toMatch(/\.glass-btn:focus-visible/)
    expect(code).toMatch(/\.tag-head:focus-visible/)
    // aria-disabled : ni survol ni appui sur les boutons en verre.
    expect(code).toMatch(/\.glass-btn:active:not\(:disabled\):not\(\[aria-disabled='true'\]\)/)
  })

  it('bouton en verre posé sur une carte (on-glass) : aucun backdrop-filter', () => {
    const rule = block('.glass-btn.on-glass {')
    expect(rule).toMatch(/-webkit-backdrop-filter:\s*none/)
    expect(rule).toMatch(/[^-]backdrop-filter:\s*none/)
  })

  it('tags : verre neutre comme les notes, liseré et lueur discrets de la couleur du tag, texte de la couleur, sans flou', () => {
    const both = block('.tag-chip,\n.tag-pill {')
    expect(both).toMatch(/--glass-btn-glow:\s*radial-gradient\([^;]*var\(--chip-fg\) var\(--chip-glow\)/)
    expect(both).toMatch(/--glass-btn-rim:\s*color-mix\(in srgb, var\(--chip-fg\) var\(--chip-rim\), transparent\)/)
    expect(both).toMatch(/color:\s*var\(--chip-fg\)/)
    expect(both).not.toMatch(/background-color/) // pas de remplissage coloré : le verre neutre de .glass-btn
    const pill = block('}\n.tag-pill {')
    expect(pill).toMatch(/background-color:\s*var\(--chip-body\)/)
    expect(block('}\n.tag-chip {')).toMatch(/background-color:\s*var\(--chip-body\)/)
    expect(both + block('}\n.tag-chip {') + pill).not.toMatch(/backdrop-filter|blur\(/)
    for (const root of [':root {', '.dark {']) {
      // Plus discret que les boutons de notation (lueur 20-30 %, liseré 50-60 %).
      expect(Number(block(root).match(/--chip-glow:\s*(\d+)%/)![1])).toBeLessThanOrEqual(15)
      expect(Number(block(root).match(/--chip-rim:\s*(\d+)%/)![1])).toBeLessThanOrEqual(35)
      for (const v of ['--chip-body', '--chip-sheen', '--chip-hover-sheen', '--chip-highlight']) expect(block(root)).toContain(`${v}:`)
    }
    const empty = block('.tag-chip-empty {')
    expect(empty).toMatch(/color:\s*var\(--tag-empty-fg\)/)
    expect(empty).toMatch(/background-color:\s*transparent/)
    expect(empty).toMatch(/outline:\s*1px dashed/)
  })
})
