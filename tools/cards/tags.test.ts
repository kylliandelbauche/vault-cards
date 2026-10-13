// @vitest-environment node
// Garde-fou contre la dérive entre shared/tags.ts, la contrainte SQL et les variables CSS.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TAGS } from '../../shared/tags.ts'

const repo = path.join(import.meta.dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

/** Contenu du premier bloc `<selector> { … }` de premier niveau. */
function block(css: string, selector: string): string {
  const m = css.match(new RegExp(`^${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)^\\}`, 'm'))
  if (!m) throw new Error(`bloc ${selector} introuvable`)
  return m[1]
}

describe('alignement des tags', () => {
  it('les slugs de shared/tags.ts sont exactement ceux de la contrainte SQL', () => {
    const sql = read('supabase/migrations/20261013000000_tags.sql')
    const arr = sql.match(/tags\s*<@\s*array\[([^\]]*)\]/i)
    expect(arr).not.toBeNull()
    const sqlSlugs = [...arr![1].matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(sqlSlugs.sort()).toEqual(TAGS.map(t => t.slug).sort())
  })

  it('chaque couleur a sa variable --tag-<color>-fg en clair (:root) et en sombre (.dark)', () => {
    const css = read('src/index.css')
    for (const selector of [':root', '.dark']) {
      const body = block(css, selector)
      for (const { color } of TAGS) {
        for (const kind of ['fg']) {
          expect(body, `${selector} --tag-${color}-${kind}`).toMatch(new RegExp(`--tag-${color}-${kind}:\\s*#[0-9a-f]{6}`, 'i'))
        }
      }
    }
  })
})
