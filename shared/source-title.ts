/**
 * Titre de la source d'une carte : source unique, importée par l'app (src/) et par l'outil (tools/cards).
 * `extractTitle` = premier H1 de la note ; `humanizeFileName` = repli quand il n'y a pas de titre
 * (pas de H1, ou carte créée avant #35 et pas encore remplie par la commande `titles`).
 */

/** Plafond de la contrainte SQL `cards_source_title_check` : 1 à 200 caractères (`char_length` = points de code). */
export const SOURCE_TITLE_MAX = 200

/** Plafonne à SOURCE_TITLE_MAX points de code (jamais au milieu d'un emoji) ; `…` si coupé. */
function capLength(text: string): string {
  const points = Array.from(text)
  if (points.length <= SOURCE_TITLE_MAX) return text
  return points.slice(0, SOURCE_TITLE_MAX - 1).join('').trimEnd() + '…'
}

/** Nom de fichier lisible : dernier segment du chemin, sans `-synthese.md`, tirets → espaces, majuscule initiale. */
export function humanizeFileName(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName
  const stem = base.replace(/-synthese\.md$/, '').replace(/\.md$/, '')
  const words = stem.replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  if (words === '') return capLength(base)
  return capLength(words.charAt(0).toUpperCase() + words.slice(1))
}

/** Retire le frontmatter YAML en tête (`---` … `---`). Non refermé : le texte est gardé tel quel. */
function stripFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trim() !== '---') return lines
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
  return end === -1 ? lines : lines.slice(end + 1)
}

/** Ouverture d'un bloc de code (``` ou ~~~, 3 minimum). Info string d'un ``` sans backtick (CommonMark). */
function openingFence(line: string): { char: string; length: number } | null {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null
  return { char: m[1][0], length: m[1].length }
}

function closesFence(line: string, fence: { char: string; length: number }): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
  return m !== null && m[1][0] === fence.char && m[1].length >= fence.length
}

/** Contenu d'un H1 ATX : sans séquence fermante (` ##`), qui doit suivre un espace (`C#` reste intact). */
function h1Text(line: string): string {
  const m = /^#[ \t]+(.*)$/.exec(line)
  return m ? m[1].replace(/(^|[ \t]+)#+[ \t]*$/, '').trim() : ''
}

/** Premier `# ` H1 (hors BOM, frontmatter et blocs de code), sinon nom de fichier humanisé. Toujours 1 à 200 caractères. */
export function extractTitle(markdown: string, fileName: string): string {
  let fence: { char: string; length: number } | null = null
  for (const line of stripFrontmatter(markdown.replace(/^\uFEFF/, '').split(/\r?\n/))) {
    if (fence) {
      if (closesFence(line, fence)) fence = null
      continue
    }
    fence = openingFence(line)
    if (fence) continue
    const title = h1Text(line)
    if (title) return capLength(title)
  }
  return humanizeFileName(fileName)
}
