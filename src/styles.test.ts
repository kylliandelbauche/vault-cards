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

describe('index.css : replis du verre (#19)', () => {
  it('le verre floute avec et sans préfixe WebKit', () => {
    const glass = block('.glass,\n.glass-card {')
    expect(glass).toMatch(/-webkit-backdrop-filter:\s*blur/)
    expect(glass).toMatch(/[^-]backdrop-filter:\s*blur/)
  })

  it.each([
    ['@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'],
  ])('fond opaque sous %s', prelude => {
    expect(block(prelude)).toMatch(/\.glass[^{]*\{[^}]*background-color:\s*var\(--glass-solid\)/)
  })

  it('la carte en verre (#40) partage les replis opaques des barres, avec le même jeton', () => {
    for (const prelude of [
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
    ]) {
      expect(block(prelude)).toMatch(/\.glass-card[^{]*\{[^}]*background-color:\s*var\(--glass-solid\)/)
    }
    expect(block('.glass-card {')).not.toMatch(/touch-action/)
    for (const root of [':root {', '.dark {']) expect(block(root)).toContain('--glass-card-bg:')
  })

  it.each([
    ['@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))'],
  ])('boutons en verre (#39) : teinte opaque sous %s', prelude => {
    expect(block(prelude)).toMatch(/\.glass-btn\s*\{[^}]*background-color:\s*var\(--glass-btn-solid\)/)
  })

  it('boutons en verre : chaque teinte a sa variante translucide et opaque, en clair et en sombre', () => {
    for (const tone of ['new', 'again', 'hard', 'good']) {
      for (const root of [':root {', '.dark {']) {
        expect(block(root)).toMatch(new RegExp(`--glass-btn-${tone}:\\s*rgb\\([^)]*/ 0\\.\\d+\\)`))
        expect(block(root)).toContain(`--glass-btn-${tone}-solid:`)
      }
      expect(block(`.glass-btn-${tone} {`)).toContain(`var(--glass-btn-${tone}-solid)`)
    }
    expect(block('.glass-btn-neutral {')).toContain('var(--glass-solid)')
  })

  it('full liquid glass (#39, demande de Kyllian) : replis Réduire la transparence / Augmenter le contraste reportés', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/prefers-reduced-transparency|prefers-contrast/)
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

/** CSS sans commentaires (les commentaires citent ce qu'on s'interdit). */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

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
    expect(code).not.toMatch(/transition:\s*(all|box-shadow|background|backdrop)/)
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
