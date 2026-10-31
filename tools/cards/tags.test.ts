// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  LEGACY_TAG_NAMES, MAX_TAGS, TAG_CONTROL_CLASS, TAG_NAME_MAX, TAG_SPACE_CLASS, byTagName, cleanTagNames, normalizeTagName, tagKey, tagNameError,
} from '../../shared/tags.ts'

const repo = path.join(import.meta.dirname, '..', '..')
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8')

describe('règles de nom de tag (#79)', () => {
  it('normalise les espaces et la forme Unicode', () => {
    expect(normalizeTagName('  IA   &\tagents ')).toBe('IA & agents')
    expect(normalizeTagName('Se\u0301curite\u0301')).toBe('Sécurité')
    expect(tagKey(' SÉCURITÉ ')).toBe(tagKey('sécurité'))
  })

  it('espaces Unicode : bords retirés puis espaces internes réduits, comme le serveur (#94)', () => {
    expect(normalizeTagName('\tfoo\n')).toBe('foo')
    expect(normalizeTagName('\u00a0IA\u3000\u2003&\u202fagents\ufeff')).toBe('IA & agents')
    expect(normalizeTagName('a\u2028\u2029b')).toBe('a b')
    // Ni espace pour JavaScript ni pour la liste : gardés tels quels (U+200B) ou refusés ensuite (contrôles).
    expect(normalizeTagName('a\u200bb')).toBe('a\u200bb')
    expect(normalizeTagName(' a\u0085 ')).toBe('a\u0085')
  })

  it('la liste d’espaces est exactement le \\s de JavaScript', () => {
    const listed = new RegExp(`^[${TAG_SPACE_CLASS}]$`)
    for (let cp = 0; cp <= 0xffff; cp++) {
      const c = String.fromCharCode(cp)
      if (listed.test(c) !== /^\s$/.test(c)) throw new Error(`U+${cp.toString(16)} diffère`)
    }
  })

  it('refuse les caractères de contrôle C0 et C1 restant après normalisation', () => {
    for (const name of ['a\u0001b', 'a\u001fb', 'a\u007fb', 'a\u0085b', 'a\u009fb']) {
      expect(tagNameError(normalizeTagName(name))).toMatch(/invalide/)
    }
    expect(tagNameError(normalizeTagName('a\u00a0b'))).toBeNull()
  })

  it('refuse une moiti\u00e9 d\'emoji isol\u00e9e, accepte un emoji entier (#98)', () => {
    for (const name of ['a\ud83db', 'a\ude00b', '\ud83d']) {
      expect(tagNameError(normalizeTagName(name))).toMatch(/invalide/)
    }
    expect(tagNameError(normalizeTagName('a\ud83d\ude00b'))).toBeNull()
  })

  it('dédoublonne sans tenir compte de la casse et reprend l’orthographe connue', () => {
    expect(cleanTagNames(['ia & agents', 'IA & AGENTS', ' Nouveau  tag '], ['IA & agents'])).toEqual(['IA & agents', 'Nouveau tag'])
  })

  it('refuse un nom vide, trop long ou non textuel', () => {
    expect(() => cleanTagNames(['  '])).toThrow(/vide/)
    expect(() => cleanTagNames(['x'.repeat(TAG_NAME_MAX + 1)])).toThrow(/trop long/)
    expect(cleanTagNames(['é'.repeat(TAG_NAME_MAX)])).toHaveLength(1)
    expect(() => cleanTagNames([3])).toThrow(/invalide/)
    expect(() => cleanTagNames(['a\u0000b'])).toThrow(/invalide/)
  })

  it('trie A–Z sans tenir compte de la casse ni des accents', () => {
    expect(['Culture', 'cerveau', 'Argent', 'Éthique', 'dev'].sort(byTagName)).toEqual(['Argent', 'cerveau', 'Culture', 'dev', 'Éthique'])
  })
})

describe('alignement avec la migration', () => {
  const sql = read('supabase/migrations/20261021000000_free_tags.sql')

  it('les anciens slugs sont renommés exactement comme dans LEGACY_TAG_NAMES', () => {
    const pairs = [...sql.matchAll(/\('([a-z]+)', '([^']+)'\)/g)].map(m => [m[1], m[2]])
    expect(Object.fromEntries(pairs)).toEqual(LEGACY_TAG_NAMES)
    for (const name of Object.values(LEGACY_TAG_NAMES)) expect(sql).toContain(`('${name}')`)
  })

  it('normalisation et caractères de contrôle identiques au serveur (#94)', () => {
    const fix = read('supabase/migrations/20261022000000_tags_sync_fix.sql')
    // Comparaison indépendante de la mise en forme : commentaires SQL et blancs retirés, casse ignorée (des deux côtés).
    const compact = (s: string) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, '').toLowerCase()
    const body = /function public\.tag_name_normalize\(p_name text\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(fix)?.[1] ?? ''
    // Même ordre : NFC, puis bords retirés, puis espaces internes réduits ; même liste d'espaces aux trois endroits.
    expect(compact(body)).toBe(compact(`
      select regexp_replace(
        regexp_replace(normalize(p_name, nfc), '^[${TAG_SPACE_CLASS}]+|[${TAG_SPACE_CLASS}]+$', '', 'g'),
        '[${TAG_SPACE_CLASS}]+', ' ', 'g')`))
    expect(compact(fix)).toContain(compact(`t !~ '[${TAG_CONTROL_CLASS}]'`))
    expect(compact(fix)).toContain(compact('t = public.tag_name_normalize(t)'))
  })

  it('mêmes limites que la contrainte SQL', () => {
    expect(sql).toMatch(new RegExp(`cardinality\\(tags\\) <= ${MAX_TAGS}`))
    expect(sql).toMatch(new RegExp(`char_length\\(name\\) between 1 and ${TAG_NAME_MAX}`))
  })
})
