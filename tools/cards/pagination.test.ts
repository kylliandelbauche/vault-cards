// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllByKey, sortCardsForOutput, KEYSET_PAGE_SIZE } from './lib.ts'
import { fetchTagNames } from './inbox-cli.ts'
import { fetchAll, fetchCardTags, fetchLiveCardPaths, fetchTitledCards } from './reads.ts'

// Ids de type uuid, triés comme le fait Postgres (comparaison d'octets de la forme canonique en minuscules).
const uuid = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const id = (n: number) => uuid('0', n)

describe('readAllByKey (#70 : pagination par clé, plus de .range())', () => {
  const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: id(i + 1) }))

  /** Faux serveur : `id > after` trié par id, au plus `limit` lignes (et `maxRows` si le serveur plafonne plus bas) ; `before` simule des écritures entre deux pages. */
  function server(rows: { id: string }[], opts: { before?: (call: number) => void; maxRows?: number } = {}) {
    const calls: { after: string | null; limit: number }[] = []
    const page = async (after: string | null, limit: number) => {
      opts.before?.(calls.length)
      calls.push({ after, limit })
      return rows.filter(r => after === null || r.id > after).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, Math.min(limit, opts.maxRows ?? limit))
    }
    return { page, calls }
  }

  it('plusieurs pages : toutes les lignes, dans l’ordre, chaque page repart de la dernière clé lue, fin sur page vide', async () => {
    const { page, calls } = server(table(7))
    const got = await readAllByKey(page, 3)
    expect(got.map(r => r.id)).toEqual(table(7).map(r => r.id))
    expect(calls).toEqual([
      { after: null, limit: 3 },
      { after: id(3), limit: 3 },
      { after: id(6), limit: 3 },
      { after: id(7), limit: 3 }, // page de 0 ligne : seule fin de lecture
    ])
  })

  it('page pleine suivie d’une page vide : s’arrête, sans doublon', async () => {
    const { page, calls } = server(table(6))
    const got = await readAllByKey(page, 3)
    expect(got).toHaveLength(6)
    expect(calls).toHaveLength(3)
    expect(calls[2]).toEqual({ after: id(6), limit: 3 })
  })

  it('table vide, et moins d’une page : une page vide termine la lecture', async () => {
    expect(await readAllByKey(server([]).page, 3)).toEqual([])
    const small = server(table(2))
    expect(await readAllByKey(small.page, 3)).toHaveLength(2)
    expect(small.calls).toHaveLength(2)
  })

  it('serveur plafonné sous la taille de page (max_rows < size) : aucune troncature', async () => {
    const { page, calls } = server(table(7), { maxRows: 2 })
    const got = await readAllByKey(page, 5)
    expect(got.map(r => r.id)).toEqual(table(7).map(r => r.id))
    expect(calls.map(c => c.after)).toEqual([null, id(2), id(4), id(6), id(7)])
  })

  it('taille par défaut = 1000', async () => {
    expect(KEYSET_PAGE_SIZE).toBe(1000)
    const { page, calls } = server(table(2500))
    expect(await readAllByKey(page)).toHaveLength(2500)
    expect(calls.map(c => c.limit)).toEqual([1000, 1000, 1000, 1000])
  })

  it('ligne retirée du résultat pendant la lecture : aucune autre ligne sautée ni lue deux fois', async () => {
    // Avec .range(), retirer une ligne de la 1re page décale tout : la ligne suivante (id 4) serait sautée.
    const rows = table(8)
    const live = server(rows, {
      before: call => {
        if (call === 1) rows.splice(rows.findIndex(r => r.id === id(2)), 1) // « supprimée » (deleted_at) entre deux pages
      },
    })
    const got = await readAllByKey(live.page, 3)
    expect(got.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map(id)) // id(2) lue avant son retrait, une seule fois
  })

  it('ligne ajoutée pendant la lecture : lue si elle est après le curseur, aucune autre perturbée', async () => {
    const rows = table(6)
    const live = server(rows, {
      before: call => {
        if (call === 1) rows.push({ id: id(9) })
      },
    })
    const got = await readAllByKey(live.page, 3)
    expect(got.map(r => r.id)).toEqual([1, 2, 3, 4, 5, 6, 9].map(id))
    expect(new Set(got.map(r => r.id)).size).toBe(got.length)
  })

  it('refuse une réponse incohérente au lieu de boucler ou de dupliquer', async () => {
    await expect(readAllByKey(async () => [{ id: 'b' }, { id: 'a' }], 2)).rejects.toThrow(/non triées/)
    await expect(readAllByKey(async () => [{ id: 'a' }, { id: 'a' }], 2)).rejects.toThrow(/non triées/)
    await expect(readAllByKey(async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 2)).rejects.toThrow(/page de 2 au plus/)
    // Un serveur qui rejouerait toujours la même page est détecté dès la 2e page.
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

/**
 * Faux client Supabase (PostgREST) : select / eq / is / in / gt / order / limit, thenable comme un vrai constructeur de requêtes.
 * Applique les filtres, trie par la colonne demandée, plafonne à `maxRows` (1000 par défaut) et ne renvoie que les colonnes
 * du select. Enregistre chaque requête pour vérifier les curseurs `gt('id', …)`.
 */
function fakeDb(tables: Record<string, Record<string, unknown>[]>, maxRows = 1000) {
  const queries: { table: string; columns: string[]; after: string | null; order: string | null; limit: number | null; eq: [string, unknown][] }[] = []
  const db = {
    from(table: string) {
      const q = { table, columns: [] as string[], after: null as string | null, order: null as string | null, limit: null as number | null, eq: [] as [string, unknown][] }
      const filters: ((r: Record<string, unknown>) => boolean)[] = []
      const builder = {
        select(columns: string) { q.columns = columns.split(',').map(c => c.trim()); return builder },
        eq(column: string, value: unknown) { q.eq.push([column, value]); filters.push(r => r[column] === value); return builder },
        is(column: string, value: unknown) { filters.push(r => r[column] === value); return builder },
        in(column: string, values: unknown[]) { filters.push(r => values.includes(r[column])); return builder },
        gt(column: string, value: string) {
          if (column !== 'id') throw new Error('clé inattendue')
          q.after = value
          filters.push(r => (r[column] as string) > value)
          return builder
        },
        order(column: string) { q.order = column; return builder },
        limit(n: number) { q.limit = n; return builder },
        then(resolve: (r: { data: Record<string, unknown>[]; error: null }) => void) {
          queries.push(q)
          const col = q.order ?? 'id'
          const rows = (tables[table] ?? []).filter(r => filters.every(f => f(r))).sort((a, b) => ((a[col] as string) < (b[col] as string) ? -1 : 1))
          const data = rows.slice(0, Math.min(q.limit ?? maxRows, maxRows)).map(r => Object.fromEntries(q.columns.map(c => [c, r[c]])))
          resolve({ data, error: null })
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { db, queries }
}

describe('fetchTagNames (#70) : pagination par clé sur la table tags', () => {
  const tagId = (n: number) => uuid('1', n)

  it('lit plus de 1000 tags sans en sauter ni en répéter, et les renvoie A–Z (pas dans l’ordre des ids)', async () => {
    // Noms à l'envers de l'ordre des ids : l'ordre A–Z doit venir du tri, pas de la pagination.
    const tags = Array.from({ length: 2300 }, (_, i) => ({ id: tagId(i + 1), name: `tag ${String(2300 - i).padStart(4, '0')}` }))
    const { db, queries } = fakeDb({ tags })
    const names = await fetchTagNames(db)
    expect(names).toHaveLength(2300)
    expect(names[0]).toBe('tag 0001')
    expect(names[2299]).toBe('tag 2300')
    expect(names).toEqual([...names].sort())
    expect(queries.map(q => q.after)).toEqual([null, tagId(1000), tagId(2000), tagId(2300)])
    expect(queries.every(q => q.order === 'id' && q.limit === 1000 && q.table === 'tags')).toBe(true)
  })

  it('A–Z insensible à la casse et aux accents, comme l’ancien order(name) de la base', async () => {
    const { db } = fakeDb({ tags: [
      { id: tagId(1), name: 'Sécurité' }, { id: tagId(2), name: 'cerveau' }, { id: tagId(3), name: 'IA & agents' }, { id: tagId(4), name: 'Argent' },
    ] })
    expect(await fetchTagNames(db)).toEqual(['Argent', 'cerveau', 'IA & agents', 'Sécurité'])
  })

  it('page pleine (1000 tags) suivie d’une page vide', async () => {
    const tags = Array.from({ length: 1000 }, (_, i) => ({ id: tagId(i + 1), name: `tag ${i + 1}` }))
    const { db, queries } = fakeDb({ tags })
    expect(await fetchTagNames(db)).toHaveLength(1000)
    expect(queries).toHaveLength(2)
  })
})

describe('lectures de cartes (reads.ts, #70/#100) : branches gt(id) et filtres', () => {
  const cardId = (n: number) => uuid('2', n)
  // 2500 cartes vault vivantes + des intrus : une carte supprimée, une carte manual, une carte inbox.
  const vault = Array.from({ length: 2500 }, (_, i) => ({
    id: cardId(i + 1),
    source: 'vault',
    deleted_at: null,
    source_path: `note ${(i * 7) % 13}.md`,
    source_title: `Titre ${i % 13}`,
    front: `q${i}`,
    back: `r${i}`,
    tags: [`t${i % 5}`],
    created_at: new Date(Date.UTC(2026, 9, 1) + ((i * 31) % 2500) * 1000).toISOString().replace('Z', '+00:00'),
  }))
  const noise = [
    { ...vault[0], id: cardId(9001), deleted_at: '2026-10-02T00:00:00+00:00' },
    { ...vault[0], id: cardId(9002), source: 'manual' },
    { ...vault[0], id: cardId(9003), source: 'inbox' },
  ]
  const cards = [...vault, ...noise]

  it('fetchAll : plus de 1000 cartes, sans intrus, curseurs gt(id) page après page, ordre (source_path, created_at, id) fixe', async () => {
    const { db, queries } = fakeDb({ cards })
    const got = await fetchAll(db)
    expect(got).toHaveLength(2500)
    expect(new Set(got.map(c => c.id)).size).toBe(2500)
    expect(got.every(c => c.id < cardId(9000))).toBe(true) // ni supprimée, ni manual, ni inbox
    // Curseurs : chaque page repart de la dernière clé de la précédente ; la dernière (vide) clôt la lecture.
    expect(queries.map(q => q.after)).toEqual([null, cardId(1000), cardId(2000), cardId(2500)])
    expect(queries.every(q => q.order === 'id' && q.limit === 1000 && q.eq.some(([c, v]) => c === 'source' && v === 'vault'))).toBe(true)
    // Sortie : mêmes champs qu'avant (pas de created_at).
    expect(Object.keys(got[0])).toEqual(['id', 'source_path', 'source_title', 'front', 'back', 'tags'])
  })

  it('fetchAll : ordre de sortie attendu fixe (source_path, created_at, id), ids dans le désordre', async () => {
    const row = (n: number, source_path: string, created_at: string) =>
      ({ id: cardId(n), source: 'vault', deleted_at: null, source_path, source_title: null, front: 'q', back: 'r', tags: [], created_at })
    const { db } = fakeDb({ cards: [
      row(1, 'b.md', '2026-10-12T10:00:00+00:00'),
      row(2, 'a.md', '2026-10-12T10:00:05+00:00'),
      row(3, 'a.md', '2026-10-12T10:00:01.5+00:00'),
      row(4, 'a.md', '2026-10-12T10:00:05+00:00'), // même created_at que 2 : départage par id
      row(5, 'a.md', '2026-10-12T10:00:01.25+00:00'),
    ] })
    expect((await fetchAll(db)).map(c => c.id)).toEqual([cardId(5), cardId(3), cardId(2), cardId(4), cardId(1)])
  })

  it('fetchLiveCardPaths : pagination par clé par paquet de chemins, cartes vivantes du vault seulement', async () => {
    const { db, queries } = fakeDb({ cards })
    const got = await fetchLiveCardPaths(db, ['note 0.md', 'note 1.md'])
    const expected = vault.filter(c => c.source_path === 'note 0.md' || c.source_path === 'note 1.md').length
    expect(got).toHaveLength(expected)
    expect(expected).toBeGreaterThan(300)
    expect(queries.every(q => q.eq.some(([c, v]) => c === 'source' && v === 'vault'))).toBe(true)
    expect(queries[0].after).toBeNull()
    expect(queries.slice(1).every(q => q.after !== null)).toBe(true)
  })

  it('fetchLiveCardPaths : serveur plafonné à 100 lignes (max_rows < 1000) — aucune troncature', async () => {
    const { db, queries } = fakeDb({ cards }, 100)
    const got = await fetchLiveCardPaths(db, ['note 0.md'])
    expect(got).toHaveLength(vault.filter(c => c.source_path === 'note 0.md').length)
    expect(queries.length).toBeGreaterThan(2)
  })

  it('fetchCardTags et fetchTitledCards : tout est lu, page par page', async () => {
    const a = fakeDb({ cards })
    expect(await fetchCardTags(a.db)).toHaveLength(2500)
    expect(a.queries.map(q => q.after)).toEqual([null, cardId(1000), cardId(2000), cardId(2500)])
    const b = fakeDb({ cards })
    expect(await fetchTitledCards(b.db)).toHaveLength(2500)
    expect(b.queries.map(q => q.after)).toEqual([null, cardId(1000), cardId(2000), cardId(2500)])
  })
})

describe('sortCardsForOutput (#100) : ordre de sortie de la commande all', () => {
  const card = (id: string, source_path: string, created_at: string) => ({ id, source_path, created_at })

  it('trie par source_path, puis created_at, puis id', () => {
    const got = sortCardsForOutput([
      card('3', 'b.md', '2026-10-12T10:00:00+00:00'),
      card('2', 'a.md', '2026-10-12T11:00:00+00:00'),
      card('1', 'a.md', '2026-10-12T10:00:00+00:00'),
      card('5', 'a.md', '2026-10-12T11:00:00+00:00'), // même created_at que 2 : départage par id
    ])
    expect(got.map(c => c.id)).toEqual(['1', '2', '5', '3'])
  })

  it('compare created_at comme un instant : fractions sans zéros finaux, microsecondes, fuseau', () => {
    const got = sortCardsForOutput([
      card('a', 'x', '2026-10-12T10:00:00.5+00:00'), // .5 = .500000 > .123456
      card('b', 'x', '2026-10-12T10:00:00.123456+00:00'),
      card('c', 'x', '2026-10-12T10:00:00.123457+00:00'),
      card('d', 'x', '2026-10-12T10:00:00+00:00'),
      card('e', 'x', '2026-10-12T12:00:00+02:00'), // = 10:00:00Z, même instant que d : id
    ])
    expect(got.map(c => c.id)).toEqual(['d', 'e', 'b', 'c', 'a'])
  })

  it('ne modifie pas le tableau reçu et refuse une date illisible', () => {
    const input = [card('2', 'b', '2026-10-12T10:00:00+00:00'), card('1', 'a', '2026-10-12T10:00:00+00:00')]
    sortCardsForOutput(input)
    expect(input.map(c => c.id)).toEqual(['2', '1'])
    expect(() => sortCardsForOutput([card('1', 'a', 'hier'), card('2', 'a', 'demain')])).toThrow(/illisible/)
  })

  it('chemins avec emoji : ordre de collation (en-US), pas d’unités de code UTF-16', () => {
    // Ordre relevé sur la vraie base (#100, `order=source_path`, ICU en-US) : 🤖 🧠 puis 😴 🚫.
    // Un tri par unités de code UTF-16 donnerait 😴 🚫 🤖 🧠 : ce test échoue si on y revient.
    const paths = ['🚫', '😴', '🧠', '🤖'].map((p, i) => card(String(i), `${p} a.md`, '2026-10-12T10:00:00+00:00'))
    expect(sortCardsForOutput(paths).map(c => String.fromCodePoint(c.source_path.codePointAt(0)!))).toEqual(['🤖', '🧠', '😴', '🚫'])
  })
})

describe('tools/cards (#70) : cli.ts et inbox-cli.ts', () => {
  it('plus de .range( sur les lectures de cartes ni de tags', async () => {
    for (const file of ['cli.ts', 'reads.ts', 'inbox-cli.ts']) {
      expect(await fs.readFile(path.join(import.meta.dirname, file), 'utf8')).not.toMatch(/\.range\(/)
    }
  })

  it('reads.ts : toute lecture de cards passe par vaultOnly', async () => {
    const src = await fs.readFile(path.join(import.meta.dirname, 'reads.ts'), 'utf8')
    const uses = src.match(/\.from\(\s*['"`]cards['"`]\s*\)/g) ?? []
    const filtered = src.match(/vaultOnly\(db\.from\('cards'\)\.select\(/g) ?? []
    expect(uses.length).toBeGreaterThan(0)
    expect(filtered.length).toBe(uses.length)
    expect(src).not.toMatch(/\.(update|insert|upsert|delete|rpc)\(/)
  })

  // listAll (Storage, `inbox purge`) pagine encore par limit/offset : suivi dans l'issue #101, hors de ce correctif.
})
