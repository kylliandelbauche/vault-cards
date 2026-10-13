// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { extractTitle, humanizeFileName, SOURCE_TITLE_MAX } from '../../shared/source-title.ts'

/** Surrogate isolé = chaîne mal formée (String#isWellFormed n'est pas dans la lib ES2023 de l'outil). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('humanizeFileName', () => {
  it('retire -synthese.md, remplace les tirets par des espaces, majuscule initiale', () => {
    expect(humanizeFileName('claude-code-hooks-synthese.md')).toBe('Claude code hooks')
  })
  it('accepte un chemin complet (garde le dernier segment)', () => {
    expect(humanizeFileName('3-Resources/veille/ia/x/prompt-caching-synthese.md')).toBe('Prompt caching')
  })
  it('nom sans suffixe -synthese : retire seulement .md', () => {
    expect(humanizeFileName('notes-du-jour.md')).toBe('Notes du jour')
  })
  it('conserve un emoji initial et ne casse pas les accents', () => {
    expect(humanizeFileName('🛡️ x-synthese.md')).toBe('🛡️ x')
    expect(humanizeFileName('éthique-des-agents-synthese.md')).toBe('Éthique des agents')
  })
  it('espaces multiples écrasés, jamais vide', () => {
    expect(humanizeFileName('a--b-synthese.md')).toBe('A b')
    expect(humanizeFileName('-synthese.md')).toBe('-synthese.md')
  })
})

describe('extractTitle', () => {
  it('premier H1 du document, trim', () => {
    expect(extractTitle('# Mon titre  \n\ntexte', 'x-synthese.md')).toBe('Mon titre')
  })
  it('ignore le frontmatter YAML (même avec un # dedans)', () => {
    const md = '---\ntitle: autre\n# pas un titre\n---\n\n# Vrai titre\n'
    expect(extractTitle(md, 'x-synthese.md')).toBe('Vrai titre')
  })
  it('ignore ## et ###, prend le premier H1 même s’il vient après', () => {
    expect(extractTitle('## Sous\ntexte\n# Le H1\n# Un autre', 'x-synthese.md')).toBe('Le H1')
  })
  it('ignore un # dans un bloc de code', () => {
    expect(extractTitle('```sh\n# commentaire\n```\n# Titre', 'x-synthese.md')).toBe('Titre')
  })
  it('fins de ligne Windows', () => {
    expect(extractTitle('# Titre\r\ntexte', 'x-synthese.md')).toBe('Titre')
  })
  it('#hashtag collé (sans espace) n’est pas un titre', () => {
    expect(extractTitle('#ia\n', 'mon-fichier-synthese.md')).toBe('Mon fichier')
  })
  it('sans H1 ou H1 vide : repli sur le nom de fichier', () => {
    expect(extractTitle('juste du texte', 'mon-fichier-synthese.md')).toBe('Mon fichier')
    expect(extractTitle('#   \ntexte', 'mon-fichier-synthese.md')).toBe('Mon fichier')
  })
  it('frontmatter jamais refermé : traité comme du texte, pas de plantage', () => {
    expect(extractTitle('---\n# Titre', 'x-synthese.md')).toBe('Titre')
  })
  it('titre plafonné à SOURCE_TITLE_MAX', () => {
    const t = extractTitle('# ' + 'a'.repeat(300), 'x-synthese.md')
    expect(t.length).toBe(SOURCE_TITLE_MAX)
    expect(t.endsWith('…')).toBe(true)
  })
  it('troncature par points de code : un emoji à la frontière n’est jamais coupé en deux', () => {
    const t = extractTitle('# ' + 'a'.repeat(198) + '😀' + 'zzz', 'x-synthese.md')
    expect(Array.from(t)).toHaveLength(SOURCE_TITLE_MAX)
    expect(t).not.toMatch(LONE_SURROGATE)
    expect(t.endsWith('…')).toBe(true)
  })
  it('emoji juste avant la limite (199e point de code) : conservé entier', () => {
    const t = extractTitle('# ' + 'a'.repeat(198) + '😀' + 'zzz', 'x-synthese.md')
    expect(t).toBe('a'.repeat(198) + '😀…')
    expect(t).not.toMatch(LONE_SURROGATE)
  })
  it('200 points de code exactement : pas de troncature, même avec des emojis (> 200 unités UTF-16)', () => {
    const t = '😀'.repeat(200)
    expect(extractTitle('# ' + t, 'x-synthese.md')).toBe(t)
  })
  it('repli sur le nom de fichier plafonné aussi', () => {
    const t = extractTitle('sans titre', 'b'.repeat(300) + '-synthese.md')
    expect(Array.from(t)).toHaveLength(SOURCE_TITLE_MAX)
    expect(t.endsWith('…')).toBe(true)
    expect(Array.from(humanizeFileName('c'.repeat(250) + '.md'))).toHaveLength(SOURCE_TITLE_MAX)
  })
  it('bloc de code : seul le même caractère (et au moins la même longueur) le ferme', () => {
    expect(extractTitle('```\n~~~\n# dans le code\n```\n# Titre', 'x-synthese.md')).toBe('Titre')
    expect(extractTitle('~~~\n```\n# dans le code\n~~~\n# Titre', 'x-synthese.md')).toBe('Titre')
    expect(extractTitle('````\n```\n# dans le code\n````\n# Titre', 'x-synthese.md')).toBe('Titre')
  })
  it('# Titre ## : les # de fermeture sont retirés, pas ceux collés au mot', () => {
    expect(extractTitle('# Titre ##', 'x-synthese.md')).toBe('Titre')
    expect(extractTitle('# Titre #   ', 'x-synthese.md')).toBe('Titre')
    expect(extractTitle('# Apprendre C#', 'x-synthese.md')).toBe('Apprendre C#')
    expect(extractTitle('# ##\n# Suivant', 'x-synthese.md')).toBe('Suivant')
  })
  it('BOM en tête ignoré (H1 en 1re ligne, ou frontmatter)', () => {
    expect(extractTitle('\uFEFF# Titre', 'x-synthese.md')).toBe('Titre')
    expect(extractTitle('\uFEFF---\na: 1\n---\n# Titre', 'x-synthese.md')).toBe('Titre')
  })
})
