/**
 * Titre de la source d'une carte : source unique, importée par l'app (src/) et par l'outil (tools/cards).
 * `extractTitle` = premier H1 de la note ; `humanizeFileName` = repli quand il n'y a pas de titre
 * (pas de H1, ou carte créée avant #35 et pas encore remplie par la commande `titles`).
 */

/** Plafond de la contrainte SQL `cards_source_title_check` (1 à 200 caractères). */
export const SOURCE_TITLE_MAX = 200

/** Nom de fichier lisible : dernier segment du chemin, sans `-synthese.md`, tirets → espaces, majuscule initiale. */
export function humanizeFileName(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName
  const stem = base.replace(/-synthese\.md$/, '').replace(/\.md$/, '')
  const words = stem.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  if (words === '') return base
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Retire le frontmatter YAML en tête (`---` … `---`). Non refermé : le texte est gardé tel quel. */
function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== '---') return lines
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
  return end === -1 ? lines : lines.slice(end + 1)
}

/** Premier `# ` H1 (hors frontmatter et blocs de code), sinon nom de fichier humanisé. Toujours 1 à 200 caractères. */
export function extractTitle(markdown: string, fileName: string): string {
  let inFence = false
  for (const line of stripFrontmatter(markdown.split(/\r?\n/))) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = /^#[ \t]+(.*)$/.exec(line)
    const title = m?.[1].trim()
    if (title) return title.length > SOURCE_TITLE_MAX ? title.slice(0, SOURCE_TITLE_MAX - 1) + '…' : title
  }
  return humanizeFileName(fileName)
}
