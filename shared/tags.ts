/**
 * Tags thématiques : source unique, importée par l'app (src/) et par l'outil (tools/cards).
 * Ajouter un tag = l'ajouter ici + nouvelle migration qui élargit la contrainte `cards_tags_check`
 * + (si nouvelle couleur) variables CSS `--tag-<color>-bg|fg` en clair ET en `.dark` dans src/index.css :
 * elles sont indexées par la clé `color`, pas par le slug. Le test tools/cards/tags.test.ts vérifie l'alignement.
 */
export interface TagDef {
  slug: string
  label: string
  emoji: string
  /** Clé de couleur : suffixe des variables CSS `--tag-<color>-bg` / `--tag-<color>-fg`. */
  color: string
}

export const TAGS = [
  { slug: 'ia', label: 'IA & agents', emoji: '🤖', color: 'violet' },
  { slug: 'dev', label: 'Dev & outils', emoji: '🛠️', color: 'bleu' },
  { slug: 'securite', label: 'Sécurité', emoji: '🔐', color: 'rouge' },
  { slug: 'marketing', label: 'Marketing & vente', emoji: '📈', color: 'orange' },
  { slug: 'argent', label: 'Argent & business', emoji: '💰', color: 'vert' },
  { slug: 'mental', label: 'Mental & psycho', emoji: '🧠', color: 'rose' },
  { slug: 'productivite', label: 'Productivité', emoji: '⏱️', color: 'jaune' },
  { slug: 'culture', label: 'Culture', emoji: '📚', color: 'grisbleu' },
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
