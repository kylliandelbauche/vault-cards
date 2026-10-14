// @vitest-environment node
// Garde-fou contre la dérive entre shared/tags.ts et la contrainte SQL.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { TAGS } from '../../shared/tags.ts'

const repo = path.join(import.meta.dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

describe('alignement des tags', () => {
  it('les slugs de shared/tags.ts sont exactement ceux de la contrainte SQL', () => {
    const sql = read('supabase/migrations/20261013000000_tags.sql')
    const arr = sql.match(/tags\s*<@\s*array\[([^\]]*)\]/i)
    expect(arr).not.toBeNull()
    const sqlSlugs = [...arr![1].matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(sqlSlugs.sort()).toEqual(TAGS.map(t => t.slug).sort())
  })
})
