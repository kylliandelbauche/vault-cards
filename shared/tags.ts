/**
 * Tags thématiques : source unique, importée par l'app (src/) et par l'outil (tools/cards).
 * Ajouter un tag = l'ajouter ici + nouvelle migration qui élargit la contrainte `cards_tags_check`
 * + (si nouvelle couleur) variable CSS `--tag-<color>-fg` en clair ET en `.dark` dans src/index.css :
 * elles sont indexées par la clé `color`, pas par le slug. Le test tools/cards/tags.test.ts vérifie l'alignement.
 * Pas d'icône (#53) : un tag est reconnu à son libellé et à sa couleur (un futur tag créé dans l'app n'aura pas d'icône).
 */
export interface TagDef {
  slug: string
  label: string
  /** Clé de couleur : suffixe de la variable CSS `--tag-<color>-fg` (texte, liseré et lueur du tag). */
  color: string
}

export const TAGS = [
  { slug: 'ia', label: 'IA & agents', color: 'violet' },
  { slug: 'dev', label: 'Dev & outils', color: 'bleu' },
  { slug: 'securite', label: 'Sécurité', color: 'rouge' },
  { slug: 'marketing', label: 'Marketing & vente', color: 'orange' },
  { slug: 'argent', label: 'Argent & business', color: 'vert' },
  { slug: 'mental', label: 'Mental & psycho', color: 'rose' },
  { slug: 'productivite', label: 'Productivité', color: 'jaune' },
  { slug: 'culture', label: 'Culture', color: 'turquoise' },
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
