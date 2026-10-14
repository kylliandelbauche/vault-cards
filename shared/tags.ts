/**
 * Tags thématiques : source unique, importée par l'app (src/) et par l'outil (tools/cards).
 * Ajouter un tag = l'ajouter ici + nouvelle migration qui élargit la contrainte `cards_tags_check`
 * (le test tools/cards/tags.test.ts vérifie l'alignement).
 * Ni icône (#53) ni couleur (#63) : un tag est reconnu à son libellé seul, en verre neutre.
 */
export interface TagDef {
  slug: string
  label: string
}

export const TAGS = [
  { slug: 'ia', label: 'IA & agents' },
  { slug: 'dev', label: 'Dev & outils' },
  { slug: 'securite', label: 'Sécurité' },
  { slug: 'marketing', label: 'Marketing & vente' },
  { slug: 'argent', label: 'Argent & business' },
  { slug: 'mental', label: 'Mental & psycho' },
  { slug: 'productivite', label: 'Productivité' },
  { slug: 'culture', label: 'Culture' },
] as const satisfies readonly TagDef[]

export type TagSlug = (typeof TAGS)[number]['slug']

export const TAG_SLUGS: readonly string[] = TAGS.map((t) => t.slug)

export const MAX_TAGS = 2

export function isTagSlug(value: unknown): value is TagSlug {
  return typeof value === 'string' && TAG_SLUGS.includes(value)
}

/** Définition d'un tag, ou `undefined` si le slug est inconnu (jamais d'exception). */
export function getTag(slug: string): TagDef | undefined {
  return TAGS.find((t) => t.slug === slug)
}
