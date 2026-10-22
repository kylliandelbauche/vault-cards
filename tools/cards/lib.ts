import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SOURCE_TITLE_MAX, extractTitle } from '../../shared/source-title.ts'
import { LEGACY_TAG_NAMES, MAX_TAGS, byTagName, cleanTagNames } from '../../shared/tags.ts'

/** `frontmatter_tags` : tags libres de la note ; `tag_hints` : tags existants qui leur correspondent à coup sûr (indices, pas une décision). */
export interface NoteFile {
  source_path: string; deck: string; content_hash: string; title: string; abs_path: string
  frontmatter_tags: string[]; tag_hints: string[]
}
export interface IncomingCard { id?: string; front: string; back: string; tags: string[] }
/** `source_title` : présent pour une note modifiée, absent pour une note `removed`. */
export interface ApplyPayload { source_path: string; deck: string; content_hash: string; source_title?: string; cards: IncomingCard[] }
export interface ExistingCard { id: string; front: string; back: string; tags: string[] }
export interface RetagEntry { id: string; tags: string[] }
export interface RetagTarget extends RetagEntry { deleted_at: string | null }
export interface NoteRow { source_path: string; content_hash: string }

/** Hash stocké dans `notes` pour une note supprimée du vault (ses cartes sont supprimées). */
export const REMOVED_HASH = 'removed'

/** Dossier des synthèses dans le vault (#76) : fichiers `.md` à plat, `Transcriptions/` et `.base` ignorés. */
export const NOTES_SUBDIR = '3-Resources/Second cerveau'

/** Deck unique des cartes du vault : le classement se fait par tags (#53), plus par dossier. */
export const DECK = 'Second cerveau'

/** Seule valeur de `type:` (frontmatter) qui donne des cartes. */
export const SYNTHESE_TYPE = 'synthese'

const FRONT_MAX = 500
const BACK_MAX = 1500

/** Chemin relatif en `/`, normalisé NFC (APFS conserve la forme écrite, la base doit rester stable). */
function toPosix(rel: string): string {
  return rel.split(path.sep).join('/').normalize('NFC')
}

/** Chemin relatif sans `.`, `..`, segment vide, antislash ni `/` initial (un `/` final est retiré par l'appelant si voulu). */
function isSafeRelative(p: string): boolean {
  return p !== '' && !p.includes('\\') && p.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..')
}

/** Dossier des notes : `VAULT_NOTES_DIR` (relatif au vault) ou NOTES_SUBDIR. */
export function resolveNotesDir(value: string | undefined): string {
  if (value === undefined || value.trim() === '') return NOTES_SUBDIR
  const dir = value.trim().replace(/\/+$/, '')
  if (!isSafeRelative(dir)) throw new Error('VAULT_NOTES_DIR invalide : chemin relatif au vault attendu, sans « . », « .. » ni antislash')
  return dir
}

function unquote(v: string): string {
  const t = v.trim()
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1).trim() : t
}

/** `type` et `tags` du frontmatter YAML de tête (sous-ensemble utile : `tags: [a, b]` ou liste en bloc). */
export function parseFrontmatter(markdown: string): { type: string | null; tags: string[] } {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/)
  const none = { type: null, tags: [] }
  if (lines[0]?.trim() !== '---') return none
  const end = lines.findIndex((l, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(l))
  if (end === -1) return none
  let type: string | null = null
  let tags: string[] = []
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i])
    if (!m) continue
    if (m[1] === 'type') type = unquote(m[2])
    if (m[1] !== 'tags') continue
    const inline = /^\[(.*)\]\s*$/.exec(m[2].trim())
    if (inline) tags = inline[1].split(',').map(unquote).filter(t => t !== '')
    else if (m[2].trim() === '') {
      tags = []
      for (let j = i + 1; j < end; j++) {
        const item = /^\s*-\s+(.*)$/.exec(lines[j])
        if (!item) break
        tags.push(unquote(item[1]))
      }
    } else tags = [unquote(m[2])]
  }
  return { type, tags }
}

export function isSynthese(markdown: string): boolean {
  return parseFrontmatter(markdown).type === SYNTHESE_TYPE
}

/**
 * Tags du frontmatter → tag de l'app (les 8 tags d'origine, par leur ancien slug, cf. LEGACY_TAG_NAMES), quand la
 * correspondance est évidente. Le reste : jugement du modèle, qui réutilise d'abord la liste `tags` (#79).
 */
const TAG_HINTS: Record<string, keyof typeof LEGACY_TAG_NAMES> = {
  ia: 'ia', agents: 'ia', agent: 'ia', claude_code: 'ia', modeles_ia: 'ia', llm: 'ia', prompt: 'ia', prompting: 'ia',
  developpement: 'dev', dev: 'dev', python: 'dev', javascript: 'dev', typescript: 'dev', backend: 'dev', frontend: 'dev',
  bases_de_donnees: 'dev', architecture: 'dev', tests: 'dev', outils: 'dev', mise_en_production: 'dev',
  securite: 'securite', cybersecurite: 'securite', pentest: 'securite',
  marketing: 'marketing', acquisition: 'marketing', copywriting: 'marketing', vente: 'marketing',
  argent: 'argent', business: 'argent', saas: 'argent', finance: 'argent', entrepreneuriat: 'argent',
  developpement_personnel: 'mental', psychologie: 'mental', mindset: 'mental', mental: 'mental', apprentissage: 'mental',
  productivite: 'productivite', habitudes: 'productivite', priorites: 'productivite', organisation: 'productivite',
  culture: 'culture', loisirs: 'culture', histoire: 'culture',
}

/** Indices de tags (ordre du frontmatter, sans doublon) : noms de tags de l'app. */
export function suggestTags(frontmatterTags: readonly string[]): string[] {
  const out: string[] = []
  for (const t of frontmatterTags) {
    const slug = TAG_HINTS[t.trim().toLowerCase()]
    const name = slug && LEGACY_TAG_NAMES[slug]
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** Synthèses du vault : `.md` de premier niveau de `subdir` (non cachés) dont le frontmatter dit `type: synthese`. */
export async function listSyntheses(vaultRoot: string, subdir = NOTES_SUBDIR): Promise<NoteFile[]> {
  const base = path.join(vaultRoot, subdir)
  const entries = await fs.readdir(base, { withFileTypes: true })
  const notes: NoteFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name.startsWith('.')) continue
    const abs_path = path.join(base, entry.name)
    const content = await fs.readFile(abs_path, 'utf8')
    const fm = parseFrontmatter(content)
    if (fm.type !== SYNTHESE_TYPE) continue
    notes.push({
      source_path: toPosix(path.relative(vaultRoot, abs_path)),
      deck: DECK,
      content_hash: hashContent(content),
      title: extractTitle(content, entry.name),
      abs_path,
      frontmatter_tags: fm.tags,
      tag_hints: suggestTags(fm.tags),
    })
  }
  return notes.sort((a, b) => a.source_path.localeCompare(b.source_path))
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function diffCards(existing: ExistingCard[], incoming: IncomingCard[]): {
  toInsert: IncomingCard[]; toUpdate: ExistingCard[]; toDelete: string[]
} {
  const byId = new Map(existing.map(c => [c.id, c]))
  const kept = new Set<string>()
  const toInsert: IncomingCard[] = []
  const toUpdate: ExistingCard[] = []
  for (const card of incoming) {
    if (card.id === undefined) {
      toInsert.push({ front: card.front, back: card.back, tags: card.tags })
      continue
    }
    const current = byId.get(card.id)
    if (!current) throw new Error('id inconnu: ' + card.id)
    if (kept.has(card.id)) throw new Error('id en double: ' + card.id)
    kept.add(card.id)
    if (current.front !== card.front || current.back !== card.back || !sameTags(current.tags, card.tags)) {
      toUpdate.push({ id: card.id, front: card.front, back: card.back, tags: card.tags })
    }
  }
  const toDelete = existing.filter(c => !kept.has(c.id)).map(c => c.id)
  return { toInsert, toUpdate, toDelete }
}

/** L'ordre compte : le 1er tag est le tag principal. */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i])
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireText(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key]
  if (typeof v !== 'string' || v.trim() === '') throw new Error(`${where} : « ${key} » doit être un texte non vide`)
  return v.trim()
}

/**
 * Tags libres (#79) : liste de 1 à MAX_TAGS noms, chacun trimé (espaces internes réduits), 1 à 40 caractères ;
 * doublons de casse retirés (le premier gardé). Plus de liste fixe : un nom inconnu sera un nouveau tag.
 */
export function requireTagList(v: unknown, where: string): string[] {
  if (!Array.isArray(v)) throw new Error(`${where} : « tags » doit être une liste de 1 à ${MAX_TAGS} tags`)
  let tags: string[]
  try {
    tags = cleanTagNames(v)
  } catch (e) {
    throw new Error(`${where} : ${(e as Error).message}`, { cause: e })
  }
  if (tags.length < 1 || tags.length > MAX_TAGS) throw new Error(`${where} : « tags » doit être une liste de 1 à ${MAX_TAGS} tags`)
  return tags
}

function requireTags(obj: Record<string, unknown>, where: string): string[] {
  return requireTagList(obj.tags, where)
}

/**
 * Ramène les tags de chaque carte à l'orthographe des tags existants (« ia & agents » → « IA & agents ») : le diff
 * ne voit pas de faux changement, et l'écriture est déjà celle que poserait le trigger serveur.
 */
export function canonicalTags<T extends { tags: string[] }>(cards: readonly T[], known: readonly string[]): T[] {
  return cards.map(c => ({ ...c, tags: cleanTagNames(c.tags, known) }))
}

/** Liste des tags pour l'IA : chaque tag existant avec son nombre de cartes vivantes du vault, A–Z. */
export function tagCounts(names: readonly string[], cards: readonly { tags: string[] }[]): { name: string; cards: number }[] {
  const counts = new Map(names.map(n => [n.toLowerCase(), 0]))
  for (const c of cards) for (const t of c.tags) {
    const k = t.toLowerCase()
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1)
  }
  return [...names].sort(byTagName).map(name => ({ name, cards: counts.get(name.toLowerCase()) ?? 0 }))
}

/** Une faute de frappe (`ID` au lieu de `id`) ferait traiter la carte comme nouvelle et perdre sa progression. */
function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new Error(`${where} : clé inconnue « ${key} » (attendues : ${allowed.join(', ')})`)
  }
}

export function validatePayload(p: unknown): ApplyPayload {
  if (!isRecord(p)) throw new Error('payload invalide : objet JSON attendu')
  rejectUnknownKeys(p, ['source_path', 'deck', 'content_hash', 'source_title', 'cards'], 'payload')
  const source_path = requireText(p, 'source_path', 'payload')
  const deck = requireText(p, 'deck', 'payload')
  const content_hash = requireText(p, 'content_hash', 'payload')
  if (!Array.isArray(p.cards)) throw new Error('payload : « cards » doit être une liste (éventuellement vide)')
  const cards = p.cards.map((raw: unknown, i: number): IncomingCard => {
    const where = `carte ${i + 1}`
    if (!isRecord(raw)) throw new Error(`${where} : objet {front, back} attendu`)
    rejectUnknownKeys(raw, ['id', 'front', 'back', 'tags'], where)
    const front = requireText(raw, 'front', where)
    const back = requireText(raw, 'back', where)
    if (front.length > FRONT_MAX) throw new Error(`${where} : question trop longue (${front.length} > ${FRONT_MAX})`)
    if (back.length > BACK_MAX) throw new Error(`${where} : réponse trop longue (${back.length} > ${BACK_MAX})`)
    const tags = requireTags(raw, where)
    if (raw.id === undefined) return { front, back, tags }
    if (typeof raw.id !== 'string' || raw.id === '') throw new Error(`${where} : « id » doit être un texte (ou absent)`)
    return { id: raw.id, front, back, tags }
  })
  if (content_hash === REMOVED_HASH) {
    if (cards.length > 0) throw new Error('payload : un content_hash « removed » exige « cards » vide')
    if (p.source_title !== undefined) throw new Error('payload : « source_title » interdit pour une note « removed »')
    return { source_path, deck, content_hash, cards }
  }
  const source_title = requireText(p, 'source_title', 'payload')
  if (source_title.length > SOURCE_TITLE_MAX) {
    throw new Error(`payload : « source_title » trop long (${source_title.length} > ${SOURCE_TITLE_MAX})`)
  }
  return { source_path, deck, content_hash, source_title, cards }
}

/** Un payload `removed` n'est valable que si la note a réellement disparu du vault (vault mal monté mis à part, couvert par --confirm-delete). */
export function assertRemovedNoteGone(source_path: string, stillExists: boolean): void {
  if (stillExists) throw new Error(`note « removed » mais le fichier existe encore sur le disque : ${source_path} (relancer scan)`)
}

const LIST_MAX = 50
const FRONT_PREVIEW = 70

/**
 * Garde-fou central : l'IA ne supprime jamais de cartes d'elle-même, quelle qu'en soit la cause
 * (note `removed`, carte retirée ou `cards: []` sur une note modifiée). Toute suppression exige
 * `--confirm-delete=<n>` avec n = nombre EXACT de cartes concernées ; sinon refus avant toute écriture,
 * avec la liste (id + début de la question) à montrer à Kyllian. Le flag reste passable par l'agent :
 * il protège de l'oubli et du rejeu, et l'obligation de recopier n force à relire le chiffre présenté.
 */
export function assertDeleteConfirmed(source_path: string, toDelete: { id: string; front: string }[], confirmed: number | null): void {
  const n = toDelete.length
  if (confirmed === n || (n === 0 && confirmed === null)) return
  const shown = toDelete.slice(0, LIST_MAX).map(c => {
    const front = c.front.replace(/\s+/g, ' ')
    return `  - ${c.id} : ${front.length > FRONT_PREVIEW ? front.slice(0, FRONT_PREVIEW) + '…' : front}`
  })
  if (n > LIST_MAX) shown.push(`  … et ${n - LIST_MAX} autres`)
  const head = confirmed === null
    ? `suppression refusée pour ${source_path} : ${n} carte(s) seraient supprimées`
    : `--confirm-delete=${confirmed} ne correspond pas à ${source_path} : ${n} carte(s) seraient supprimées`
  throw new Error(
    `${head}${n > 0 ? ' :\n' + shown.join('\n') : ''}\n` +
    `Montrer cette liste à Kyllian ; relancer avec --confirm-delete=${n} uniquement après sa confirmation explicite.`,
  )
}

export const USAGE =
  'usage : node tools/cards/cli.ts scan | tags | existing <source_path> | all | apply <fichier.json> [--confirm-delete=<n>] | retag <fichier.json> | titles | relink <fichier.json>'

export interface ParsedArgs { command: string | undefined; arg: string | undefined; confirmDelete: number | null }

/** Options : seule `--confirm-delete=<n>` (n entier), réservée à `apply`. */
export function parseArgs(argv: string[]): ParsedArgs {
  let confirmDelete: number | null = null
  const positional: string[] = []
  for (const a of argv) {
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    if (a !== '--confirm-delete' && !a.startsWith('--confirm-delete=')) throw new Error(`option inconnue : ${a}\n${USAGE}`)
    const value = a.slice('--confirm-delete='.length)
    if (!a.includes('=') || !/^\d+$/.test(value)) throw new Error(`${a} : valeur manquante ou invalide, attendu --confirm-delete=<n> (n entier)`)
    if (confirmDelete !== null) throw new Error('--confirm-delete ne peut être passé qu’une seule fois')
    confirmDelete = Number(value)
  }
  if (positional.length > 2) throw new Error(USAGE)
  const [command, arg] = positional
  if (confirmDelete !== null && command !== 'apply') throw new Error(`option --confirm-delete réservée à apply\n${USAGE}`)
  return { command, arg, confirmDelete }
}

/** Paquets de `size` éléments (URL PostgREST bornées : pas de `.in()` géant). */
export function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunk : taille invalide')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Taille de page des lectures complètes. Une page plus courte signifie « fin des données » : elle ne doit pas
 * dépasser `max_rows` de l'API Supabase (1000 par défaut), sinon la lecture s'arrêterait trop tôt sans erreur.
 */
export const KEYSET_PAGE_SIZE = 1000

/**
 * Lit toutes les lignes d'une requête, page par page, en pagination par clé (keyset, #70) : `page(after, limit)` renvoie
 * au plus `limit` lignes d'`id` strictement supérieur à `after` (tout depuis le début si `after` est null), triées par
 * `id`. Contrairement à un décalage `.range()`, une ligne ajoutée ou modifiée pendant la lecture ne décale pas les
 * suivantes : aucune ligne n'est sautée ni lue deux fois (`id` est unique et ne change jamais). Même principe que
 * `src/lib/sync.ts`, avec `id` seul comme clé : la lecture est complète, pas incrémentale.
 */
export async function readAllByKey<T extends { id: string }>(
  page: (after: string | null, limit: number) => Promise<T[]>,
  size: number = KEYSET_PAGE_SIZE,
): Promise<T[]> {
  if (!Number.isInteger(size) || size < 1) throw new Error('readAllByKey : taille invalide')
  const rows: T[] = []
  let after: string | null = null
  for (;;) {
    const got: T[] = await page(after, size)
    if (got.length > size) throw new Error(`lecture paginée : ${got.length} lignes reçues pour une page de ${size} au plus`)
    for (const row of got) {
      if (after !== null && !(row.id > after)) throw new Error('lecture paginée : lignes non triées par id (ligne lue deux fois ou ordre inattendu)')
      after = row.id
      rows.push(row)
    }
    if (got.length < size) return rows
  }
}

/** Nombre de cartes vivantes par note `removed` (rows = cartes vivantes de ces notes), pour les présenter avant suppression. */
export function countLiveCards(removed: string[], liveRows: { source_path: string }[]): { source_path: string; live_cards: number }[] {
  const counts = new Map<string, number>()
  for (const r of liveRows) counts.set(r.source_path, (counts.get(r.source_path) ?? 0) + 1)
  return removed.map(source_path => ({ source_path, live_cards: counts.get(source_path) ?? 0 }))
}

/**
 * Le hash du payload doit être celui du fichier tel qu'il est maintenant (même fonction que `scan`) :
 * sinon les cartes ont été écrites pour une autre version de la note, ou le payload est un vieux fichier rejoué.
 * Non applicable à REMOVED_HASH (le fichier n'existe plus).
 */
export function assertContentHashFresh(declared: string, currentContent: string): void {
  if (declared !== hashContent(currentContent)) throw new Error('note modifiée depuis le scan, relancer scan')
}

/**
 * `source_path` doit avoir exactement la forme produite par `scan` : `<subdir>/<nom>.md` (pas de sous-dossier,
 * nom non caché), relatif, sans `.`, `..` ni segment vide, et `deck` doit valoir DECK.
 */
export function assertDeckMatchesPath(source_path: string, deck: string, subdir = NOTES_SUBDIR): void {
  const invalid = (why: string): never => {
    throw new Error(`source_path « ${source_path} » invalide : ${why} (attendu ${subdir}/<nom>.md)`)
  }
  const parts = source_path.split('/')
  if (source_path.includes('\\') || parts.some(p => p === '' || p === '.' || p === '..')) {
    invalid('chemin absolu, segment vide, « . », « .. » ou antislash')
  }
  const prefix = subdir.split('/')
  if (!prefix.every((seg, i) => parts[i] === seg)) invalid(`ne commence pas par ${subdir}/`)
  const rest = parts.slice(prefix.length)
  if (rest.length !== 1) invalid('la note doit être directement dans le dossier (pas de sous-dossier)')
  const name = rest[0]
  if (!name.endsWith('.md') || name.startsWith('.')) invalid('pas un fichier .md visible')
  if (deck !== DECK) throw new Error(`deck « ${deck} » incohérent avec source_path « ${source_path} » : attendu « ${DECK} »`)
}

/** Chemin absolu d'une note ; refuse tout ce qui sortirait du vault (défense en profondeur après assertDeckMatchesPath). */
export function resolveInVault(vaultRoot: string, source_path: string): string {
  const root = path.resolve(vaultRoot)
  const abs = path.resolve(root, source_path)
  if (!abs.startsWith(root + path.sep)) throw new Error(`source_path « ${source_path} » hors du vault`)
  return abs
}

/** Fichier de `retag` : liste de {id, tags}. Tout autre champ est ignoré (le texte n'est jamais modifié). */
export function validateRetagPayload(p: unknown): RetagEntry[] {
  if (!Array.isArray(p)) throw new Error('retag : liste JSON de {id, tags} attendue')
  const seen = new Set<string>()
  return p.map((raw: unknown, i: number): RetagEntry => {
    const where = `entrée ${i + 1}`
    if (!isRecord(raw)) throw new Error(`${where} : objet {id, tags} attendu`)
    const id = requireText(raw, 'id', where)
    if (seen.has(id)) throw new Error('id en double: ' + id)
    seen.add(id)
    return { id, tags: requireTags(raw, where) }
  })
}

/**
 * Compare aux cartes en base (vivantes ou supprimées) : id inconnu ou carte supprimée = erreur
 * (rien n'est écrit), tags identiques = ignorés.
 */
export function planRetag(existing: RetagTarget[], entries: RetagEntry[]): { toUpdate: RetagEntry[]; unchanged: number } {
  const byId = new Map(existing.map(c => [c.id, c]))
  const toUpdate: RetagEntry[] = []
  let unchanged = 0
  for (const e of entries) {
    const current = byId.get(e.id)
    if (!current) throw new Error('id inconnu: ' + e.id)
    if (current.deleted_at !== null) throw new Error('carte supprimée: ' + e.id)
    if (sameTags(current.tags, e.tags)) unchanged++
    else toUpdate.push(e)
  }
  return { toUpdate, unchanged }
}

export interface TitledCard { id: string; source_path: string; source_title: string | null }

/**
 * Plan de `titles` : pour chaque carte vivante, le titre de sa note sur disque (`titles`, par source_path).
 * Une note introuvable fait tout refuser (rien n'est écrit) en les listant. Ne concerne ni id, ni texte, ni tags.
 * Cartes déjà à jour = `unchanged` (idempotent) ; ids regroupés par titre pour limiter les écritures.
 */
export function planTitles(cards: TitledCard[], titles: Map<string, string>): { toUpdate: { source_title: string; ids: string[] }[]; unchanged: number } {
  const missing = [...new Set(cards.map(c => c.source_path).filter(p => !titles.has(p)))].sort()
  if (missing.length > 0) {
    throw new Error(`fichier source introuvable pour ${missing.length} note(s), rien n'a été écrit :\n${missing.map(p => '  - ' + p).join('\n')}`)
  }
  const groups = new Map<string, string[]>()
  let unchanged = 0
  for (const c of cards) {
    const title = titles.get(c.source_path)!
    if (c.source_title === title) {
      unchanged++
      continue
    }
    groups.set(title, [...(groups.get(title) ?? []), c.id])
  }
  return { toUpdate: [...groups].map(([source_title, ids]) => ({ source_title, ids })), unchanged }
}

/** `apply` : cartes conservées dont seul le titre change (celles insérées/modifiées/supprimées sont déjà traitées par ailleurs). */
export function cardsNeedingTitle(existing: { id: string; source_title: string | null }[], title: string, written: Set<string>, deleted: Set<string>): string[] {
  return existing.filter(c => !written.has(c.id) && !deleted.has(c.id) && c.source_title !== title).map(c => c.id)
}

/** changed = notes nouvelles ou modifiées ; removed = notes en base absentes du disque (pas déjà marquées removed). */
export function computeScan(files: NoteFile[], rows: NoteRow[]): { changed: NoteFile[]; removed: string[] } {
  const stored = new Map(rows.map(r => [r.source_path, r.content_hash]))
  const onDisk = new Set(files.map(f => f.source_path))
  const changed = files.filter(f => stored.get(f.source_path) !== f.content_hash)
  const removed = rows
    .filter(r => !onDisk.has(r.source_path) && r.content_hash !== REMOVED_HASH)
    .map(r => r.source_path)
    .sort()
  return { changed, removed }
}

/** Origine des cartes que l'outil gère. Les cartes `manual` (créées dans l'app, #54) ne sont jamais lues ni écrites par lui. */
export const VAULT_SOURCE = 'vault'

/**
 * Restreint une requête PostgREST sur `cards` (select ou update) aux cartes du vault. Seule porte d'accès de
 * cli.ts à la table (vérifié par lib.test.ts) : scan, existing, all, apply, retag et titles ignorent les cartes manuelles.
 */
export function vaultOnly<Q>(query: Q): Q {
  // Typage minimal volontaire : contraindre Q au constructeur de requêtes PostgREST fait exploser l'inférence (TS2589).
  // Les filtres PostgREST renvoient la requête elle-même (this).
  return (query as Q & { eq(column: string, value: string): Q }).eq('source', VAULT_SOURCE)
}

export interface RelinkEntry { from: string; to: string }

/**
 * Fichier de `relink` : liste non vide de {from, to}. `from` = ancien source_path (n'importe quel chemin relatif sûr),
 * `to` = format exact de `scan`. Pas de doublon, pas de chaîne (un `to` réutilisé comme `from`).
 */
export function validateRelinkPayload(p: unknown, subdir = NOTES_SUBDIR): RelinkEntry[] {
  if (!Array.isArray(p)) throw new Error('relink : liste JSON de {from, to} attendue')
  if (p.length === 0) throw new Error('relink : liste vide')
  const entries = p.map((raw: unknown, i: number): RelinkEntry => {
    const where = `entrée ${i + 1}`
    if (!isRecord(raw)) throw new Error(`${where} : objet {from, to} attendu`)
    rejectUnknownKeys(raw, ['from', 'to'], where)
    const from = requireText(raw, 'from', where)
    const to = requireText(raw, 'to', where)
    if (!isSafeRelative(from)) throw new Error(`${where} : « from » invalide (chemin relatif au vault, sans « . », « .. », segment vide ni antislash)`)
    assertDeckMatchesPath(to, DECK, subdir)
    if (from === to) throw new Error(`${where} : « from » et « to » identiques`)
    return { from, to }
  })
  const froms = entries.map(e => e.from)
  const tos = entries.map(e => e.to)
  if (new Set(froms).size !== froms.length) throw new Error('relink : « from » en double')
  if (new Set(tos).size !== tos.length) throw new Error('relink : « to » en double')
  const chained = tos.find(t => froms.includes(t))
  if (chained) throw new Error(`relink : chaîne interdite, « ${chained} » est à la fois un to et un from`)
  return entries
}

/**
 * État lu en base et sur disque pour une entrée : ids des cartes vivantes (vault) de `from`, nombre de cartes
 * vivantes déjà sur `to`, titre et hash du fichier `to` (`to_title` null = introuvable ou pas une synthèse),
 * présence des lignes `notes` de `from` et `to`.
 */
export interface RelinkState { from_ids: string[]; to_live: number; to_title: string | null; to_hash: string; from_row: boolean; to_row: boolean }

/** rename : la ligne `from` devient `to` ; insert : `to` créée ; replace : `to` écrasée et `from` retirée ; unchanged : rien. */
export type RelinkNotesAction = 'rename' | 'insert' | 'replace' | 'unchanged'
export interface RelinkPlan { from: string; to: string; ids: string[]; source_title: string; content_hash: string; notes: RelinkNotesAction }

/**
 * Plan de `relink`, calculé pour TOUTES les entrées avant toute écriture : une seule entrée invalide fait tout refuser.
 * Idempotent : une entrée déjà rattachée (plus rien sur `from`, ligne `to` présente) est `unchanged`.
 */
export function planRelink(entries: RelinkEntry[], states: Map<string, RelinkState>): RelinkPlan[] {
  const errors: string[] = []
  const plans: RelinkPlan[] = []
  for (const e of entries) {
    const st = states.get(e.from)
    const pending = st !== undefined && (st.from_ids.length > 0 || st.from_row)
    if (!st || (!pending && !st.to_row)) {
      errors.push(`${e.from} : rien à rattacher (aucune carte vivante ni ligne notes à cet ancien chemin)`)
      continue
    }
    if (st.to_title === null) {
      errors.push(`${e.to} : fichier introuvable ou pas une synthèse (type: synthese)`)
      continue
    }
    if (st.from_ids.length > 0 && st.to_live > 0) {
      errors.push(`${e.to} : a déjà ${st.to_live} carte(s) vivante(s), fusion refusée`)
      continue
    }
    const notes: RelinkNotesAction = !pending ? 'unchanged' : st.to_row ? 'replace' : st.from_row ? 'rename' : 'insert'
    plans.push({ from: e.from, to: e.to, ids: st.from_ids, source_title: st.to_title, content_hash: st.to_hash, notes })
  }
  if (errors.length > 0) throw new Error(`relink refusé, rien n'a été écrit :\n${errors.map(m => '  - ' + m).join('\n')}`)
  return plans
}
