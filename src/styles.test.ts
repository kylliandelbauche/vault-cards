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
    ['@media (prefers-reduced-transparency: reduce)'],
    ['@media (prefers-contrast: more)'],
  ])('fond opaque sous %s', prelude => {
    expect(block(prelude)).toMatch(/\.glass[^{]*\{[^}]*background-color:\s*var\(--glass-solid\)/)
  })

  it('la carte en verre (#40) partage les replis opaques des barres, avec le même jeton', () => {
    for (const prelude of [
      '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
      '@media (prefers-reduced-transparency: reduce)',
      '@media (prefers-contrast: more)',
    ]) {
      expect(block(prelude)).toMatch(/\.glass-card[^{]*\{[^}]*background-color:\s*var\(--glass-solid\)/)
    }
    expect(block('.glass-card {')).not.toMatch(/touch-action/)
    for (const root of [':root {', '.dark {']) expect(block(root)).toContain('--glass-card-bg:')
  })

  it('Réduire la transparence / Augmenter le contraste coupent aussi le flou et rendent la carte opaque', () => {
    for (const prelude of ['@media (prefers-reduced-transparency: reduce)', '@media (prefers-contrast: more)']) {
      const b = block(prelude)
      expect(b).toMatch(/backdrop-filter:\s*none/)
      expect(b).toMatch(/background-color:\s*var\(--card-solid\)/)
    }
  })

  it('focus visible sur les boutons Konsta (qui posent focus:outline-none)', () => {
    expect(block('.k-button:focus-visible')).toMatch(/outline:\s*2px solid/)
  })

  it('variantes claire et sombre du fond et du verre', () => {
    for (const token of ['--bg-base', '--glass-bg', '--glass-solid', '--card-bg', '--card-solid']) {
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
