// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { extractTitle, humanizeFileName, SOURCE_TITLE_MAX } from '../../shared/source-title.ts'

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
})
