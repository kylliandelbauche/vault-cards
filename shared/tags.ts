/**
 * Tags libres (#79) : règles de nom partagées par l'app (src/) et l'outil (tools/cards), alignées sur les migrations
 * 20261021000000_free_tags (registre, trigger cards_tags_sync, contrainte cards_tags_check) et
 * 20261022000000_tags_sync_fix (#94 : normalisation tag_name_normalize, caractères de contrôle refusés, restauration).
 * Un tag est un NOM porté par la
 * carte (`cards.tags`) ; la table `tags` en est le registre (créé côté serveur pour les cartes actives).
 * Ni icône (#53) ni couleur (#63) : un tag est reconnu à son nom seul, en verre neutre.
 */

/** Tags par carte au plus (contrainte SQL cards_tags_check). */
export const MAX_TAGS = 5
/** Longueur d'un nom de tag, en caractères (points de code), comme char_length en SQL. */
export const TAG_NAME_MAX = 40

/**
 * « Espaces » d'un nom de tag, en syntaxe de classe d'expression régulière commune à JavaScript et Postgres : exactement
 * le `\s` / `trim()` de JavaScript, écrit en toutes lettres car le `\s` de Postgres diffère (#94). La migration
 * 20261022000000_tags_sync_fix reprend cette chaîne telle quelle (vérifié par tools/cards/tags.test.ts).
 */
export const TAG_SPACE_CLASS = '\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'
/** Caractères de contrôle (Unicode Cc) refusés dans un nom, même syntaxe ; NUL est de toute façon refusé par Postgres. */
export const TAG_CONTROL_CLASS = '\\u0000-\\u001f\\u007f-\\u009f'

const EDGE_SPACES = new RegExp(`^[${TAG_SPACE_CLASS}]+|[${TAG_SPACE_CLASS}]+$`, 'g')
const SPACE_RUNS = new RegExp(`[${TAG_SPACE_CLASS}]+`, 'g')
const CONTROL = new RegExp(`[${TAG_CONTROL_CLASS}]`)
/** Moitié de paire de substitution isolée (#98) : en mode `u`, un emoji entier reste un seul point de code et ne correspond pas. */
const LONE_SURROGATE = /\p{Cs}/u

/**
 * Forme stockée d'un nom, dans le même ordre que le serveur (public.tag_name_normalize) : NFC, espaces de bord retirés,
 * puis espaces internes réduits à un seul.
 */
export function normalizeTagName(name: string): string {
  return name.normalize('NFC').replace(EDGE_SPACES, '').replace(SPACE_RUNS, ' ')
}

/** Clé d'unicité : un même tag quelle que soit la casse ou l'espacement (index unique lower(name)). */
export const tagKey = (name: string) => normalizeTagName(name).toLowerCase()

/** Même tag (casse et espaces ignorés). */
export const sameTag = (a: string, b: string) => tagKey(a) === tagKey(b)

const chars = (s: string) => Array.from(s).length

/** Message d'erreur si le nom (déjà normalisé) est refusé, sinon null. */
export function tagNameError(name: string): string | null {
  if (name === '') return 'nom de tag vide'
  if (CONTROL.test(name) || LONE_SURROGATE.test(name)) return `nom de tag invalide « ${name} »`
  if (chars(name) > TAG_NAME_MAX) return `nom de tag trop long « ${name} » (${chars(name)} > ${TAG_NAME_MAX} caractères)`
  return null
}

/**
 * Liste de noms prête à écrire : chaque nom normalisé et validé (lève sinon), doublons de casse retirés (le premier
 * gardé), puis ramené à l'orthographe d'un tag connu de même clé (`known`). Ne vérifie pas le nombre de tags.
 */
export function cleanTagNames(names: readonly unknown[], known: Iterable<string> = []): string[] {
  const canon = new Map<string, string>()
  for (const k of known) if (!canon.has(tagKey(k))) canon.set(tagKey(k), normalizeTagName(k))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    if (typeof raw !== 'string') throw new Error(`nom de tag invalide « ${String(raw)} »`)
    const name = normalizeTagName(raw)
    const error = tagNameError(name)
    if (error) throw new Error(error)
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(canon.get(key) ?? name)
  }
  return out
}

/** Tri A–Z français, sans tenir compte de la casse ni des accents (« cerveau » entre « Argent » et « Culture »). */
export const byTagName = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) || a.localeCompare(b)

/**
 * Anciens slugs (#26) → nom du tag qui les remplace (migration 20261021000000_free_tags). Sert seulement à mettre à
 * niveau un cache local d'avant #79 (Dexie v6) ; le test tools/cards/tags.test.ts vérifie l'alignement avec la migration.
 */
export const LEGACY_TAG_NAMES: Readonly<Record<string, string>> = {
  ia: 'IA & agents',
  dev: 'Dev & outils',
  securite: 'Sécurité',
  marketing: 'Marketing & vente',
  argent: 'Argent & business',
  mental: 'Mental & psycho',
  productivite: 'Productivité',
  culture: 'Culture',
}
