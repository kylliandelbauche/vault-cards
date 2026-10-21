// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listSyntheses, parseFrontmatter, suggestTags, resolveNotesDir, validateRelinkPayload, planRelink, NOTES_SUBDIR, DECK, type RelinkState, hashContent, diffCards, validatePayload, assertContentHashFresh, assertDeckMatchesPath, assertDeleteConfirmed, assertRemovedNoteGone, chunk, resolveInVault, countLiveCards, parseArgs, computeScan, validateRetagPayload, planRetag, planTitles, cardsNeedingTitle, vaultOnly, VAULT_SOURCE, canonicalTags, tagCounts } from './lib.ts'

const root = path.join(import.meta.dirname, 'fixtures')
const SUB = 'Second cerveau' // sous-dossier des fixtures (le vrai défaut est NOTES_SUBDIR)

describe('listSyntheses (#76 : 3-Resources/Second cerveau, à plat, type: synthese)', () => {
  it('ne garde que les .md de premier niveau dont le frontmatter dit type: synthese ; deck fixe', async () => {
    const notes = await listSyntheses(root, SUB)
    // ignorés : index sans frontmatter, type: concept, Transcriptions/, .base, fichier caché
    expect(notes.map(n => [n.source_path, n.deck])).toEqual([
      ['Second cerveau/🤖 note_a.md', DECK],
      ['Second cerveau/b.md', DECK],
    ])
    expect(DECK).toBe('Second cerveau')
    expect(NOTES_SUBDIR).toBe('3-Resources/Second cerveau')
  })

  it('hash du contenu et chemin absolu lisible', async () => {
    const notes = await listSyntheses(root, SUB)
    const a = notes.find(n => n.source_path.endsWith('note_a.md'))!
    const text = await fs.readFile(a.abs_path, 'utf8')
    expect(a.content_hash).toBe(hashContent(text))
  })

  it('title = H1 humanisé (frontmatter ignoré)', async () => {
    const notes = await listSyntheses(root, SUB)
    expect(notes.map(n => n.title)).toEqual(['Note a', 'Note B'])
  })

  it('tags du frontmatter (liste en ligne ou en bloc) et indices : noms des tags de l’app', async () => {
    const notes = await listSyntheses(root, SUB)
    const [a, b] = notes
    expect(a.frontmatter_tags).toEqual(['ia', 'agents', 'cybersecurite'])
    expect(a.tag_hints).toEqual(['IA & agents', 'Sécurité'])
    expect(b.frontmatter_tags).toEqual(['developpement', 'habitudes'])
    expect(b.tag_hints).toEqual(['Dev & outils', 'Productivité'])
  })

  it('défaut : 3-Resources/Second cerveau ; chemins NFC, emoji + espace acceptés', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-cards-'))
    try {
      const dir = path.join(tmp, NOTES_SUBDIR)
      await fs.mkdir(path.join(dir, 'Transcriptions'), { recursive: true })
      await fs.writeFile(path.join(dir, '⏳ vivre_maintenant.md'), '---\ntype: synthese\n---\n# ⏳ vivre_maintenant\n')
      await fs.writeFile(path.join(dir, 'Transcriptions', '⏳ vivre_maintenant.md'), '---\ntype: synthese\n---\nbrut')
      const notes = await listSyntheses(tmp)
      expect(notes).toHaveLength(1)
      expect(notes[0].source_path).toBe('3-Resources/Second cerveau/⏳ vivre_maintenant.md')
      expect(notes[0].title).toBe('Vivre maintenant')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})

describe('parseFrontmatter', () => {
  it('type et tags (liste en ligne, guillemets retirés)', () => {
    expect(parseFrontmatter('---\ntitre: "x"\ntype: synthese\ntags: [developpement_personnel, "priorites"]\n---\n# T')).toEqual({ type: 'synthese', tags: ['developpement_personnel', 'priorites'] })
  })
  it('tags en bloc YAML', () => {
    expect(parseFrontmatter("---\ntype: 'synthese'\ntags:\n  - a\n  - b\nautre: 1\n---\n").tags).toEqual(['a', 'b'])
  })
  it('sans frontmatter, non refermé, ou type ailleurs que dans le frontmatter : rien', () => {
    expect(parseFrontmatter('# T\ntype: synthese')).toEqual({ type: null, tags: [] })
    expect(parseFrontmatter('---\ntype: synthese\n# jamais refermé')).toEqual({ type: null, tags: [] })
  })
  it('BOM et fins de ligne Windows tolérés', () => {
    expect(parseFrontmatter('\uFEFF---\r\ntype: synthese\r\n---\r\n').type).toBe('synthese')
  })
})

describe('suggestTags', () => {
  it('table de correspondance simple, ordre du frontmatter, sans doublon, jamais hors liste', () => {
    expect(suggestTags(['developpement_personnel', 'priorites', 'habitudes'])).toEqual(['Mental & psycho', 'Productivité'])
    expect(suggestTags(['cybersecurite', 'saas', 'pentest', 'ia'])).toEqual(['Sécurité', 'Argent & business', 'IA & agents'])
    expect(suggestTags(['marketing', 'acquisition', 'copywriting'])).toEqual(['Marketing & vente'])
    expect(suggestTags(['loisirs', 'minecraft'])).toEqual(['Culture'])
    expect(suggestTags(['design', 'inconnu'])).toEqual([])
  })
})

describe('resolveNotesDir (VAULT_NOTES_DIR)', () => {
  it('défaut 3-Resources/Second cerveau ; valeur relative acceptée (sans / final)', () => {
    expect(resolveNotesDir(undefined)).toBe(NOTES_SUBDIR)
    expect(resolveNotesDir('')).toBe(NOTES_SUBDIR)
    expect(resolveNotesDir('Notes/Synthèses/')).toBe('Notes/Synthèses')
  })
  it('refuse un chemin absolu, .., . ou antislash', () => {
    for (const bad of ['/etc', '../x', 'a/../b', './a', 'a\\b']) expect(() => resolveNotesDir(bad), bad).toThrow(/VAULT_NOTES_DIR/)
  })
})

describe('hashContent', () => {
  it('stable et sensible au contenu', () => {
    expect(hashContent('x')).toBe(hashContent('x'))
    expect(hashContent('x')).not.toBe(hashContent('y'))
  })
  it('sha256 hex', () => {
    expect(hashContent('x')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('diffCards', () => {
  const existing = [
    { id: '1', front: 'Q1', back: 'R1', tags: ['ia'] },
    { id: '2', front: 'Q2', back: 'R2', tags: ['dev'] },
  ]
  it('carte gardée telle quelle : ni update ni delete (progression conservée)', () => {
    const d = diffCards(existing, [{ id: '1', front: 'Q1', back: 'R1', tags: ['ia'] }])
    expect(d).toEqual({ toInsert: [], toUpdate: [], toDelete: ['2'] })
  })
  it('carte gardée mais reformulée : update avec le même id', () => {
    const d = diffCards(existing, [
      { id: '1', front: 'Q1 bis', back: 'R1', tags: ['ia'] },
      { id: '2', front: 'Q2', back: 'R2', tags: ['dev'] },
    ])
    expect(d.toUpdate).toEqual([{ id: '1', front: 'Q1 bis', back: 'R1', tags: ['ia'] }])
    expect(d.toDelete).toEqual([])
  })
  it('seul changement = tags : update avec le même id', () => {
    const d = diffCards(existing, [
      { id: '1', front: 'Q1', back: 'R1', tags: ['ia', 'securite'] },
      { id: '2', front: 'Q2', back: 'R2', tags: ['dev'] },
    ])
    expect(d).toEqual({ toInsert: [], toUpdate: [{ id: '1', front: 'Q1', back: 'R1', tags: ['ia', 'securite'] }], toDelete: [] })
  })
  it('nouvelle carte sans id : insert avec ses tags', () => {
    expect(diffCards([], [{ front: 'Q', back: 'R', tags: ['culture'] }]).toInsert).toEqual([{ front: 'Q', back: 'R', tags: ['culture'] }])
  })
  it('id inconnu : erreur (Claude ne doit pas inventer d’id)', () => {
    expect(() => diffCards(existing, [{ id: '999', front: 'Q', back: 'R', tags: ['ia'] }])).toThrow(/id inconnu/)
  })
  it('même id deux fois : erreur', () => {
    expect(() => diffCards(existing, [
      { id: '1', front: 'Q1', back: 'R1', tags: ['ia'] },
      { id: '1', front: 'Q1 bis', back: 'R1', tags: ['ia'] },
    ])).toThrow(/id en double/)
  })
  it('liste vide : toutes les cartes existantes supprimées', () => {
    expect(diffCards(existing, [])).toEqual({ toInsert: [], toUpdate: [], toDelete: ['1', '2'] })
  })
})

describe('validatePayload', () => {
  const base = { source_path: 'a.md', deck: 'ia', content_hash: 'h', source_title: 'Titre' }
  const removedBase = { source_path: 'a.md', deck: 'ia', content_hash: 'removed' }
  it('refuse une carte vide ou trop longue', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: '', back: 'R', tags: ['ia'] }] })).toThrow()
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'x'.repeat(1501), tags: ['ia'] }] })).toThrow()
  })
  it('accepte une liste vide (note sans contenu à apprendre)', () => {
    expect(validatePayload({ ...base, cards: [] }).cards).toEqual([])
  })
  it('trim le texte, garde l’id et les tags', () => {
    const p = validatePayload({ ...base, cards: [{ id: 'u1', front: '  Q ', back: 'R\n', tags: ['ia', 'dev'] }] })
    expect(p.cards).toEqual([{ id: 'u1', front: 'Q', back: 'R', tags: ['ia', 'dev'] }])
  })
  it('refuse un payload mal formé avec un message lisible', () => {
    expect(() => validatePayload(null)).toThrow(/payload/)
    expect(() => validatePayload({ source_path: 'a.md', deck: 'ia', cards: [] })).toThrow(/content_hash/)
    expect(() => validatePayload({ ...base, cards: 'x' })).toThrow(/cards/)
    expect(() => validatePayload({ ...base, cards: [{ id: 3, front: 'Q', back: 'R', tags: ['ia'] }] })).toThrow(/id/)
  })
  it('tags libres (#79) : nom nouveau accepté, trimé, espaces internes réduits', () => {
    const p = validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['  Cuisine   italienne ', 'IA & agents'] }] })
    expect(p.cards[0].tags).toEqual(['Cuisine italienne', 'IA & agents'])
  })
  it('tags : 0 tag refusé (absent ou liste vide)', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R' }] })).toThrow(/tags/)
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: [] }] })).toThrow(/tags/)
  })
  it('tags : 5 acceptés, 6 refusés', () => {
    expect(validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['a', 'b', 'c', 'd', 'e'] }] }).cards[0].tags).toHaveLength(5)
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }] })).toThrow(/1 à 5 tags/)
  })
  it('tags : nom vide ou de plus de 40 caractères refusé', () => {
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['  '] }] })).toThrow(/vide/)
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['x'.repeat(41)] }] })).toThrow(/trop long/)
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: [3] }] })).toThrow(/invalide/)
  })
  it('tags : doublons de casse dédoublonnés (le premier gardé)', () => {
    expect(validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['IA & agents', 'ia & AGENTS'] }] }).cards[0].tags).toEqual(['IA & agents'])
  })
  it('payload removed avec des cartes : refusé (il en insérerait tout en marquant la note supprimée)', () => {
    expect(() => validatePayload({ ...removedBase, cards: [{ front: 'Q', back: 'R', tags: ['ia'] }] })).toThrow(/removed.*cards/)
    expect(validatePayload({ ...removedBase, content_hash: ' removed ', cards: [] }).content_hash).toBe('removed')
  })
  it('source_title : obligatoire pour une note modifiée, trimé', () => {
    expect(validatePayload({ ...base, source_title: '  Mon titre ', cards: [] }).source_title).toBe('Mon titre')
    expect(() => validatePayload({ ...base, source_title: undefined, cards: [] })).toThrow(/source_title/)
    expect(() => validatePayload({ ...base, source_title: '  ', cards: [] })).toThrow(/source_title/)
    expect(() => validatePayload({ ...base, source_title: 42, cards: [] })).toThrow(/source_title/)
  })
  it('source_title : 200 caractères au plus (contrainte SQL)', () => {
    expect(validatePayload({ ...base, source_title: 'x'.repeat(200), cards: [] }).source_title).toHaveLength(200)
    expect(() => validatePayload({ ...base, source_title: 'x'.repeat(201), cards: [] })).toThrow(/source_title.*201/)
  })
  it('source_title : interdit pour une note removed, absent du résultat', () => {
    expect(() => validatePayload({ ...removedBase, source_title: 'Titre', cards: [] })).toThrow(/source_title.*removed/)
    expect(validatePayload({ ...removedBase, cards: [] })).toEqual({ ...removedBase, cards: [] })
  })
  it('clé inconnue sur une carte : refusée, la clé est nommée (ex. ID au lieu de id)', () => {
    expect(() => validatePayload({ ...base, cards: [{ ID: 'u1', front: 'Q', back: 'R', tags: ['ia'] }] })).toThrow(/carte 1.*« ID »/)
    expect(() => validatePayload({ ...base, cards: [{ front: 'Q', back: 'R', tags: ['ia'] }, { front: 'Q', back: 'R', tags: ['ia'], extra: 1 }] }))
      .toThrow(/carte 2.*« extra »/)
  })
  it('clé inconnue au niveau payload : refusée, la clé est nommée', () => {
    expect(() => validatePayload({ ...base, Deck: 'x', cards: [] })).toThrow(/payload.*« Deck »/)
  })
})

describe('assertDeleteConfirmed', () => {
  const cards = [{ id: 'u1', front: 'Quelle est la première question ?' }, { id: 'u2', front: 'Deuxième' }]
  it('aucune suppression : rien à confirmer', () => {
    expect(() => assertDeleteConfirmed('a.md', [], null)).not.toThrow()
  })
  it('suppression sans flag : refus qui liste id + début de la question et le flag exact attendu', () => {
    expect(() => assertDeleteConfirmed('a.md', cards, null)).toThrow(/--confirm-delete=2/)
    expect(() => assertDeleteConfirmed('a.md', cards, null)).toThrow(/u1 : Quelle est la première question/)
    expect(() => assertDeleteConfirmed('a.md', cards, null)).toThrow(/u2 : Deuxième/)
    expect(() => assertDeleteConfirmed('a.md', cards, null)).toThrow(/a\.md/)
  })
  it('flag avec le nombre exact : ok', () => {
    expect(() => assertDeleteConfirmed('a.md', cards, 2)).not.toThrow()
  })
  it('flag avec un autre nombre (trop petit, trop grand, ou 0) : refus', () => {
    for (const n of [0, 1, 3]) expect(() => assertDeleteConfirmed('a.md', cards, n)).toThrow(/--confirm-delete=2/)
  })
  it('flag alors que rien ne serait supprimé : refus (confirmation périmée)', () => {
    expect(() => assertDeleteConfirmed('a.md', [], 3)).toThrow(/--confirm-delete=0/)
  })
  it('tronque une longue question et une longue liste', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: 'c' + i, front: 'x'.repeat(200) }))
    let msg = ''
    try { assertDeleteConfirmed('a.md', many, null) } catch (e) { msg = (e as Error).message }
    expect(msg).toMatch(/--confirm-delete=80/)
    expect(msg).toMatch(/et 30 autres/)
    expect(msg).not.toMatch(/x{100}/)
  })
})

describe('parseArgs', () => {
  it('commande + argument, sans flag', () => {
    expect(parseArgs(['apply', 'f.json'])).toEqual({ command: 'apply', arg: 'f.json', confirmDelete: null })
    expect(parseArgs(['scan'])).toEqual({ command: 'scan', arg: undefined, confirmDelete: null })
  })
  it('--confirm-delete=<n> pour apply, avant ou après le fichier', () => {
    expect(parseArgs(['apply', 'f.json', '--confirm-delete=3']).confirmDelete).toBe(3)
    expect(parseArgs(['apply', '--confirm-delete=12', 'f.json'])).toEqual({ command: 'apply', arg: 'f.json', confirmDelete: 12 })
  })
  it('--confirm-delete sans valeur ou avec une valeur invalide : refusé', () => {
    for (const bad of ['--confirm-delete', '--confirm-delete=', '--confirm-delete=abc', '--confirm-delete=-1', '--confirm-delete=1.5', '--confirm-delete=true']) {
      expect(() => parseArgs(['apply', 'f.json', bad]), bad).toThrow(/--confirm-delete=<n>/)
    }
  })
  it('flag répété : refusé', () => {
    expect(() => parseArgs(['apply', 'f.json', '--confirm-delete=1', '--confirm-delete=2'])).toThrow(/une seule fois/)
  })
  it('option inconnue : refusée', () => {
    expect(() => parseArgs(['scan', '--foo'])).toThrow(/option inconnue : --foo/)
  })
  it('--confirm-delete réservé à apply', () => {
    expect(() => parseArgs(['retag', 'f.json', '--confirm-delete=1'])).toThrow(/réservée à apply/)
    expect(() => parseArgs(['scan', '--confirm-delete=1'])).toThrow(/réservée à apply/)
  })
  it('trop d’arguments : refusé', () => {
    expect(() => parseArgs(['apply', 'a.json', 'b.json'])).toThrow(/usage/)
  })
})

describe('assertRemovedNoteGone', () => {
  it('note removed encore présente sur le disque : refus', () => {
    expect(() => assertRemovedNoteGone('veille/ia/a-synthese.md', true)).toThrow(/existe encore.*veille\/ia\/a-synthese\.md/)
  })
  it('note absente : ok', () => {
    expect(() => assertRemovedNoteGone('veille/ia/a-synthese.md', false)).not.toThrow()
  })
})

describe('chunk', () => {
  it('découpe en paquets de taille donnée, le dernier plus petit', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
  it('taille invalide : erreur (évite une boucle infinie)', () => {
    expect(() => chunk([1], 0)).toThrow()
  })
})

describe('countLiveCards', () => {
  it('compte les cartes vivantes par note removed, 0 si aucune', () => {
    const rows = [{ source_path: 'a.md' }, { source_path: 'a.md' }, { source_path: 'b.md' }, { source_path: 'autre.md' }]
    expect(countLiveCards(['a.md', 'c.md'], rows)).toEqual([
      { source_path: 'a.md', live_cards: 2 },
      { source_path: 'c.md', live_cards: 0 },
    ])
  })
})

describe('assertContentHashFresh', () => {
  it('hash identique à celui du contenu actuel : ok (même fonction que scan)', () => {
    expect(() => assertContentHashFresh(hashContent('note'), 'note')).not.toThrow()
  })
  it('le content_hash émis par scan (listSyntheses) passe la vérification sur le même fichier, et échoue si le fichier change', async () => {
    const notes = await listSyntheses(root, SUB)
    expect(notes.length).toBeGreaterThan(0)
    for (const n of notes) {
      const current = await fs.readFile(n.abs_path, 'utf8')
      expect(() => assertContentHashFresh(n.content_hash, current)).not.toThrow()
      expect(() => assertContentHashFresh(n.content_hash, current + '\n')).toThrow(/modifiée depuis le scan/)
    }
  })
  it('contenu modifié depuis le scan : erreur claire', () => {
    expect(() => assertContentHashFresh(hashContent('avant'), 'après')).toThrow(/note modifiée depuis le scan, relancer scan/)
  })
})

describe('assertDeckMatchesPath (#76 : 3-Resources/Second cerveau/<nom>.md, deck fixe)', () => {
  const ok = '3-Resources/Second cerveau/⏳ vivre_maintenant.md'
  it('format exact produit par scan, deck = « Second cerveau »', () => {
    expect(() => assertDeckMatchesPath(ok, DECK)).not.toThrow()
    expect(() => assertDeckMatchesPath('3-Resources/Second cerveau/b.md', 'Second cerveau')).not.toThrow()
  })
  it('deck différent : erreur qui nomme le deck attendu', () => {
    expect(() => assertDeckMatchesPath(ok, 'ia')).toThrow(/deck « ia ».*« Second cerveau »/)
    expect(() => assertDeckMatchesPath(ok, 'second cerveau')).toThrow(/deck/)
  })
  it('refuse l’ancien format et tout ce que scan ne produit pas', () => {
    for (const bad of [
      'a.md',
      '3-Resources/veille/ia/a/a-synthese.md', // ancien vault
      'Second cerveau/a.md', // préfixe 3-Resources/ manquant
      'x/3-Resources/Second cerveau/a.md', // préfixe pas en tête
      '3-Resources/Second cerveau/Transcriptions/a.md', // sous-dossier
      '3-Resources/Second cerveau/second_cerveau.base',
      '3-Resources/Second cerveau/a.md.bak',
      '3-Resources/Second cerveau/.md',
      '3-Resources/Second cerveau/.cachee.md',
    ]) expect(() => assertDeckMatchesPath(bad, DECK), bad).toThrow(/source_path/)
  })
  it('refuse .., ., segments vides, chemins absolus et antislash', () => {
    for (const bad of [
      '3-Resources/Second cerveau/../../etc/x.md',
      '3-Resources/Second cerveau/./a.md',
      '3-Resources/Second cerveau//a.md',
      '/3-Resources/Second cerveau/a.md',
      '3-Resources/Second cerveau/a.md/',
      '3-Resources/Second cerveau/..\\a.md',
    ]) expect(() => assertDeckMatchesPath(bad, DECK), bad).toThrow(/source_path/)
  })
  it('dossier des notes configurable (comme listSyntheses)', () => {
    expect(() => assertDeckMatchesPath('Second cerveau/a.md', DECK, 'Second cerveau')).not.toThrow()
    expect(() => assertDeckMatchesPath(ok, DECK, 'Second cerveau')).toThrow(/source_path/)
  })
})

describe('validateRelinkPayload', () => {
  const to = '3-Resources/Second cerveau/⏳ vivre_maintenant.md'
  const from = '3-Resources/veille/concept/x/x-synthese.md'
  it('liste de {from, to} : from = chemin relatif sûr, to = format exact de scan', () => {
    expect(validateRelinkPayload([{ from, to }])).toEqual([{ from, to }])
  })
  it('refuse : pas une liste, liste vide, clé inconnue, champ manquant', () => {
    expect(() => validateRelinkPayload({ from, to })).toThrow(/liste/)
    expect(() => validateRelinkPayload([])).toThrow(/vide/)
    expect(() => validateRelinkPayload([{ from, to, deck: 'x' }])).toThrow(/clé inconnue « deck »/)
    expect(() => validateRelinkPayload([{ from }])).toThrow(/« to »/)
  })
  it('refuse un to hors format et un from qui sort du vault', () => {
    expect(() => validateRelinkPayload([{ from, to: '3-Resources/veille/ia/a-synthese.md' }])).toThrow(/source_path/)
    for (const bad of ['../x.md', '/etc/x.md', 'a//b.md', 'a/./b.md', 'a\\b.md']) {
      expect(() => validateRelinkPayload([{ from: bad, to }]), bad).toThrow(/from/)
    }
  })
  it('refuse from = to, from ou to en double, chaînes (un to réutilisé comme from)', () => {
    expect(() => validateRelinkPayload([{ from: to, to }])).toThrow(/identiques/)
    const to2 = '3-Resources/Second cerveau/b.md'
    expect(() => validateRelinkPayload([{ from, to }, { from, to: to2 }])).toThrow(/en double/)
    expect(() => validateRelinkPayload([{ from, to }, { from: 'a/b.md', to }])).toThrow(/en double/)
    expect(() => validateRelinkPayload([{ from, to }, { from: to, to: to2 }])).toThrow(/chaîne/)
  })
  it('dossier des notes configurable', () => {
    expect(() => validateRelinkPayload([{ from, to: 'N/a.md' }], 'N')).not.toThrow()
  })
})

describe('planRelink', () => {
  const e = { from: 'old/a-synthese.md', to: '3-Resources/Second cerveau/⏳ a.md' }
  const state = (over: Partial<RelinkState> = {}): RelinkState =>
    ({ from_ids: ['1', '2'], to_live: 0, to_title: 'A', to_hash: 'h', from_row: true, to_row: false, ...over })
  it('cartes de from rattachées (ids inchangés), ligne notes renommée avec le hash du nouveau fichier', () => {
    expect(planRelink([e], new Map([[e.from, state()]]))).toEqual([
      { from: e.from, to: e.to, ids: ['1', '2'], source_title: 'A', content_hash: 'h', notes: 'rename' },
    ])
  })
  it('pas de ligne notes pour from : insérée ; ligne to déjà là : remplacée (from supprimée)', () => {
    expect(planRelink([e], new Map([[e.from, state({ from_row: false })]]))[0].notes).toBe('insert')
    expect(planRelink([e], new Map([[e.from, state({ to_row: true })]]))[0].notes).toBe('replace')
  })
  it('idempotent : déjà rattaché (plus rien à from, ligne to présente) = unchanged, rien à écrire', () => {
    const p = planRelink([e], new Map([[e.from, state({ from_ids: [], from_row: false, to_live: 2, to_row: true })]]))
    expect(p).toEqual([{ from: e.from, to: e.to, ids: [], source_title: 'A', content_hash: 'h', notes: 'unchanged' }])
  })
  it('refuse tout (rien n’est écrit) si une seule entrée est invalide, en listant les erreurs', () => {
    const e2 = { from: 'old/b-synthese.md', to: '3-Resources/Second cerveau/b.md' }
    const states = new Map([[e.from, state()], [e2.from, state({ to_title: null })]])
    expect(() => planRelink([e, e2], states)).toThrow(/rien n'a été écrit[\s\S]*b\.md.*introuvable ou pas une synthèse/)
  })
  it('refuse : to absent / pas une synthèse, to qui a déjà des cartes, from inconnu (rien à rattacher)', () => {
    expect(() => planRelink([e], new Map([[e.from, state({ to_title: null })]]))).toThrow(/introuvable ou pas une synthèse/)
    expect(() => planRelink([e], new Map([[e.from, state({ to_live: 3 })]]))).toThrow(/a déjà 3 carte/)
    expect(() => planRelink([e], new Map([[e.from, state({ from_ids: [], from_row: false })]]))).toThrow(/rien à rattacher/)
    expect(() => planRelink([e], new Map())).toThrow(/rien à rattacher|état/)
  })
})

describe('resolveInVault', () => {
  it('résout dans le vault', () => {
    expect(resolveInVault('/v', '3-Resources/veille/ia/a-synthese.md')).toBe('/v/3-Resources/veille/ia/a-synthese.md')
  })
  it('refuse tout chemin qui sort du vault', () => {
    expect(() => resolveInVault('/v', '../etc/hosts')).toThrow(/hors du vault/)
    expect(() => resolveInVault('/v', '/etc/hosts')).toThrow(/hors du vault/)
    expect(() => resolveInVault('/v', 'a/../../w/x.md')).toThrow(/hors du vault/)
    expect(() => resolveInVault('/v', '')).toThrow(/hors du vault/)
  })
})

describe('validateRetagPayload', () => {
  it('accepte une liste de {id, tags} et ignore tout autre champ (jamais le texte)', () => {
    const p = validateRetagPayload([{ id: 'u1', tags: ['ia'], front: 'ignoré' }, { id: 'u2', tags: ['dev', 'securite'] }])
    expect(p).toEqual([{ id: 'u1', tags: ['ia'] }, { id: 'u2', tags: ['dev', 'securite'] }])
  })
  it('refuse : pas une liste, id manquant, id en double, tags invalides', () => {
    expect(() => validateRetagPayload({ id: 'u1', tags: ['ia'] })).toThrow(/liste/)
    expect(() => validateRetagPayload([{ tags: ['ia'] }])).toThrow(/id/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: ['ia'] }, { id: 'u1', tags: ['dev'] }])).toThrow(/id en double/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: ['x'.repeat(41)] }])).toThrow(/trop long/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: [] }])).toThrow(/tags/)
    expect(() => validateRetagPayload([{ id: 'u1', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }])).toThrow(/tags/)
  })
})

describe('planRetag', () => {
  const existing = [
    { id: 'u1', tags: [], deleted_at: null },
    { id: 'u2', tags: ['dev'], deleted_at: null },
    { id: 'u3', tags: ['ia'], deleted_at: '2026-10-12T00:00:00Z' },
  ]
  it('ne met à jour que les cartes dont les tags changent', () => {
    expect(planRetag(existing, [{ id: 'u1', tags: ['ia'] }, { id: 'u2', tags: ['dev'] }]))
      .toEqual({ toUpdate: [{ id: 'u1', tags: ['ia'] }], unchanged: 1 })
  })
  it('id inconnu : erreur avant toute écriture', () => {
    expect(() => planRetag(existing, [{ id: 'u1', tags: ['ia'] }, { id: 'u9', tags: ['ia'] }])).toThrow(/id inconnu: u9/)
  })
  it('id d’une carte supprimée : erreur avant toute écriture', () => {
    expect(() => planRetag(existing, [{ id: 'u1', tags: ['ia'] }, { id: 'u3', tags: ['dev'] }])).toThrow(/carte supprimée: u3/)
  })
})

describe('computeScan', () => {
  const file = (source_path: string, content_hash: string) =>
    ({ source_path, deck: DECK, content_hash, title: 'T', abs_path: '/v/' + source_path, frontmatter_tags: [], tag_hints: [] })
  it('changed = notes nouvelles ou au hash différent ; removed = notes absentes du disque', () => {
    const files = [file('a.md', 'h1'), file('b.md', 'h2'), file('c.md', 'h3')]
    const rows = [
      { source_path: 'a.md', content_hash: 'h1' },
      { source_path: 'b.md', content_hash: 'old' },
      { source_path: 'gone.md', content_hash: 'h9' },
    ]
    const s = computeScan(files, rows)
    expect(s.changed.map(f => f.source_path)).toEqual(['b.md', 'c.md'])
    expect(s.removed).toEqual(['gone.md'])
  })
  it('une note déjà marquée "removed" n’est plus signalée', () => {
    expect(computeScan([], [{ source_path: 'gone.md', content_hash: 'removed' }]).removed).toEqual([])
  })
  it('une note marquée "removed" qui réapparaît est changed', () => {
    const s = computeScan([file('gone.md', 'h1')], [{ source_path: 'gone.md', content_hash: 'removed' }])
    expect(s.changed.map(f => f.source_path)).toEqual(['gone.md'])
  })
})

describe('planTitles', () => {
  const cards = [
    { id: 'u1', source_path: 'n/a.md', source_title: null },
    { id: 'u2', source_path: 'n/a.md', source_title: 'Ancien' },
    { id: 'u3', source_path: 'n/b.md', source_title: 'B' },
  ]
  const titles = new Map([['n/a.md', 'Titre A'], ['n/b.md', 'B']])
  it('met à jour les cartes sans titre ou au titre différent, ignore celles déjà à jour', () => {
    expect(planTitles(cards, titles)).toEqual({ toUpdate: [{ source_title: 'Titre A', ids: ['u1', 'u2'] }], unchanged: 1 })
  })
  it('idempotent : un second passage ne trouve plus rien à faire', () => {
    const done = cards.map(c => ({ ...c, source_title: titles.get(c.source_path)! }))
    expect(planTitles(done, titles)).toEqual({ toUpdate: [], unchanged: 3 })
  })
  it('fichier source introuvable : refus qui liste les notes, rien à écrire', () => {
    const partial = new Map([['n/a.md', 'Titre A']])
    expect(() => planTitles(cards, partial)).toThrow(/introuvable.*n\/b\.md/s)
  })
  it('regroupe les ids par titre (un seul update par titre)', () => {
    const two = [
      { id: 'u1', source_path: 'n/a.md', source_title: null },
      { id: 'u2', source_path: 'n/c.md', source_title: null },
      { id: 'u3', source_path: 'n/d.md', source_title: null },
    ]
    const t = new Map([['n/a.md', 'X'], ['n/c.md', 'X'], ['n/d.md', 'Y']])
    expect(planTitles(two, t).toUpdate).toEqual([{ source_title: 'X', ids: ['u1', 'u2'] }, { source_title: 'Y', ids: ['u3'] }])
  })
})

describe('cardsNeedingTitle', () => {
  it('cartes conservées au titre différent, hors cartes déjà écrites ou supprimées', () => {
    const existing = [
      { id: '1', source_title: null },
      { id: '2', source_title: 'T' },
      { id: '3', source_title: 'Ancien' },
      { id: '4', source_title: null },
    ]
    expect(cardsNeedingTitle(existing, 'T', new Set(['3']), new Set(['4']))).toEqual(['1'])
  })
})

describe('cartes manuelles (#54) : jamais touchées par l’outil', () => {
  it('vaultOnly ajoute le filtre source = vault et renvoie la requête chaînable', () => {
    const calls: [string, string][] = []
    const q = { eq(column: string, value: string) { calls.push([column, value]); return q } }
    expect(vaultOnly(q)).toBe(q)
    expect(calls).toEqual([['source', VAULT_SOURCE]])
    expect(VAULT_SOURCE).toBe('vault')
  })

  it('cli.ts : toute lecture ou modification de cards passe par vaultOnly, et les insertions sont source vault', async () => {
    const cli = await fs.readFile(path.join(import.meta.dirname, 'cli.ts'), 'utf8')
    // Guillemets simples, doubles ou backticks : toute mention de la table compte.
    const uses = cli.match(/\.from\(\s*['"`]cards['"`]\s*\)/g) ?? []
    const filtered = cli.match(/vaultOnly\(db\.from\('cards'\)\.(select|update)\(/g) ?? []
    const inserts = cli.match(/db\.from\('cards'\)\.insert\(/g) ?? []
    // Aucun autre chemin vers la table : pas de nom de table ailleurs que dans .from(…), pas d'appel RPC.
    expect(cli.match(/['"`]cards['"`]/g) ?? []).toHaveLength(uses.length)
    expect(cli).not.toMatch(/\.rpc\(/)
    expect(uses.length).toBeGreaterThan(0)
    expect(filtered.length + inserts.length).toBe(uses.length)
    expect(inserts.length).toBe(1)
    expect(cli).toMatch(/source: VAULT_SOURCE/)
  })
})

describe('canonicalTags / tagCounts (#79)', () => {
  it('reprend l’orthographe des tags existants, garde les nouveaux noms', () => {
    expect(canonicalTags([{ id: '1', tags: ['ia & agents', 'Nouveau'] }], ['IA & agents'])).toEqual([{ id: '1', tags: ['IA & agents', 'Nouveau'] }])
  })
  it('compte les cartes par tag (casse ignorée), A–Z, tags vides compris', () => {
    expect(tagCounts(['Sécurité', 'IA & agents', 'cerveau'], [{ tags: ['IA & agents'] }, { tags: ['ia & agents', 'Sécurité'] }]))
      .toEqual([{ name: 'cerveau', cards: 0 }, { name: 'IA & agents', cards: 2 }, { name: 'Sécurité', cards: 1 }])
  })
})
