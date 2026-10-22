// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllByKey, KEYSET_PAGE_SIZE } from './lib.ts'
import { fetchTagNames } from './inbox-cli.ts'

describe('readAllByKey (#70 : pagination par clé, plus de .range())', () => {
  // Ids de type uuid, triés comme le fait Postgres (comparaison d'octets de la forme canonique en minuscules).
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: id(i + 1) }))

  /** Faux serveur : `id > after` trié par id, au plus `limit` lignes ; `before` simule des écritures entre deux pages. */
  function server(rows: { id: string }[], before?: (call: number) => void) {
    const calls: { after: string | null; limit: number }[] = []
    const page = async (after: string | null, limit: number) => {
      before?.(calls.length)
      calls.push({ after, limit })
      return rows.filter(r => after === null || r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, limit)
    }
    return { page, calls }
  }

  it('plusieurs pages : toutes les lignes, dans l’ordre, chaque page repart de la dernière clé lue', async () => {
    const { page, calls } = server(table(7))
    const got = await readAllByKey(page, 3)
    expect(got.map(r => r.id)).toEqual(table(7).map(r => r.id))
    expect(calls).toEqual([
      { after: null, limit: 3 },
      { after: id(3), limit: 3 },
      { after: id(6), limit: 3 },
    ])
  })

  it('page pleine suivie d’une page vide : s’arrête, sans doublon', async () => {
    const { page, calls } = server(table(6))
    const got = await readAllByKey(page, 3)
    expect(got).toHaveLength(6)
    expect(calls).toHaveLength(3)
    expect(calls[2]).toEqual({ after: id(6), limit: 3 })
  })

  it('table vide, et moins d’une page : un seul appel', async () => {
    expect(await readAllByKey(server([]).page, 3)).toEqual([])
    const small = server(table(2))
    expect(await readAllByKey(small.page, 3)).toHaveLength(2)
    expect(small.calls).toHaveLength(1)
  })

  it('taille par défaut = 1000, sous le plafond max_rows de PostgREST', async () => {
    expect(KEYSET_PAGE_SIZE).toBe(1000)
    const { page, calls } = server(table(2500))
    expect(await readAllByKey(page)).toHaveLength(2500)
    expect(calls.map(c => c.limit)).toEqual([1000, 1000, 1000])
  })

  it('ligne retirée du résultat pendant la lecture : aucune autre ligne sautée ni lue deux fois', async () => {
    // Avec .range(), retirer une ligne de la 1re page décale tout : la ligne suivante (id 4) serait sautée.
    const rows = table(8)
    const live = server(rows, call => {
      if (call === 1) rows.splice(rows.findIndex(r => r.id === id(2)), 1) // « supprimée » (deleted_at) entre deux pages
    })
    const got = await readAllByKey(live.page, 3)
    expect(got.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(id)) // id(2) lue avant son retrait, une seule fois
  })

  it('ligne ajoutée pendant la lecture : lue si elle est après le curseur, aucune autre perturbée', async () => {
    const rows = table(6)
    const live = server(rows, call => {
      if (call === 1) rows.push({ id: id(9) })
    })
    const got = await readAllByKey(live.page, 3)
    expect(got.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 9].map(id))
    expect(new Set(got.map(r => r.id)).size).toBe(got.length)
  })

  it('refuse une réponse incohérente au lieu de boucler ou de dupliquer', async () => {
    await expect(readAllByKey(async () => [{ id: 'b' }, { id: 'a' }], 2)).rejects.toThrow(/non triées/)
    await expect(readAllByKey(async () => [{ id: 'a' }, { id: 'a' }], 2)).rejects.toThrow(/non triées/)
    await expect(readAllByKey(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).rejects.toThrow(/page de 2 au plus/)
    // Un serveur qui rejouerait toujours la même page pleine est détecté dès la 2e page.
    await expect(readAllByKey(async () => [{ id: 'a' }, { id: 'b' }], 2)).rejects.toThrow(/non triées/)
    await expect(readAllByKey(async () => [], 0)).rejects.toThrow(/taille invalide/)
  })

  it('propage l’erreur de la page (rien de partiel renvoyé)', async () => {
    let n = 0
    await expect(readAllByKey(async () => {
      if (++n === 2) throw new Error('lecture des cartes : boom')
      return [{ id: 'a' }, { id: 'b' }]
    }, 2)).rejects.toThrow(/boom/)
  })
})

describe('fetchTagNames (#70) : pagination par clé sur la table tags', () => {
  const tagId = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  type Tag = { id: string; name: string }

  /** Faux client Supabase : from('tags').select().gt('id', x).order('id').limit(n), plafonné à 1000 lignes comme PostgREST. */
  function fakeDb(tags: Tag[]) {
    const queries: { after: string | null; limit: number | null; order: string | null; table: string }[] = []
    const db = {
      from(table: string) {
        const q = { after: null as string | null, limit: null as number | null, order: null as string | null, table }
        const builder = {
          select: () => builder,
          gt(column: string, value: string) {
            if (column !== 'id') throw new Error('clé inattendue')
            q.after = value
            return builder
          },
          order(column: string) { q.order = column; return builder },
          limit(n: number) { q.limit = n; return builder },
          then(resolve: (r: { data: Tag[]; error: null }) => void) {
            queries.push(q)
            const rows = tags.filter(t => q.after === null || t.id > q.after).sort((a, b) => (a.id < b.id ? -1 : 1))
            resolve({ data: rows.slice(0, Math.min(q.limit ?? 1000, 1000)), error: null })
          },
        }
        return builder
      },
    } as unknown as SupabaseClient
    return { db, queries }
  }

  it('lit plus de 1000 tags sans en sauter ni en répéter, triés par id', async () => {
    const tags = Array.from({ length: 2300 }, (_, i) => ({ id: tagId(i + 1), name: `tag ${i + 1}` }))
    const { db, queries } = fakeDb(tags)
    expect(await fetchTagNames(db)).toEqual(tags.map(t => t.name))
    expect(queries.map(q => q.after)).toEqual([null, tagId(1000), tagId(2000)])
    expect(queries.every(q => q.order === 'id' && q.limit === 1000 && q.table === 'tags')).toBe(true)
  })

  it('page pleine (1000 tags) suivie d’une page vide', async () => {
    const tags = Array.from({ length: 1000 }, (_, i) => ({ id: tagId(i + 1), name: `tag ${i + 1}` }))
    const { db, queries } = fakeDb(tags)
    expect(await fetchTagNames(db)).toHaveLength(1000)
    expect(queries).toHaveLength(2)
  })
})

describe('tools/cards (#70) : plus aucune pagination positionnelle', () => {
  it('aucun .range( dans cli.ts ni inbox-cli.ts', async () => {
    for (const file of ['cli.ts', 'inbox-cli.ts']) {
      expect(await fs.readFile(path.join(import.meta.dirname, file), 'utf8')).not.toMatch(/\.range\(/)
    }
  })
})
