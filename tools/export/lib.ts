// Export de la PWA (Supabase) vers le dossier de synchro de l'app native, format v1
// (docs/specs/2026-11-25-app-apple-native.md, « Dossier de synchro : format v1 »). Fonctions pures, testées par lib.test.ts.
// L'export est un appareil à part entière : il écrit seulement dans son propre dossier `devices/<id>/`, avec un id neuf
// à chaque export. Relancer l'export ne perd rien : la fusion garde la dernière version de chaque carte et l'union des
// révisions.

export const FORMAT = { format: 'vault-cards', version: 1 } as const
export const DEVICE_NAME = 'Import de la PWA'

export interface CardRow {
  id: string
  source: 'vault' | 'manual' | 'inbox'
  status: 'active' | 'draft'
  front: string
  back: string
  tags: string[]
  deleted_at: string | null
  created_at: string
  updated_at: string
  deck: string | null
  source_path: string | null
  source_title: string | null
}

export interface ReviewRow { id: string; card_id: string; rating: number; reviewed_at: string }

/** Fichier à écrire, chemin relatif à `VaultCards/`. */
export interface OutFile { path: string; contents: string }

const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]00(?::?00)?)$/

/**
 * Horodatage Postgres (`2026-11-25T13:16:29.123456+00:00`) → format du fichier (`2026-11-25T13:16:29.123Z`) : UTC,
 * fraction tronquée à la milliseconde (comme l'app native à la lecture). Tout autre fuseau est refusé.
 */
export function isoMillis(value: string): string {
  const m = TIMESTAMP.exec(value)
  if (!m) throw new Error(`horodatage inattendu : ${value}`)
  const out = `${m[1]}T${m[2]}.${((m[3] ?? '') + '000').slice(0, 3)}Z`
  if (Number.isNaN(Date.parse(out)) || new Date(out).toISOString() !== out) throw new Error(`horodatage invalide : ${value}`)
  return out
}

/** Ligne de `cards.jsonl` : instantané de la carte à sa dernière modification. Clés triées, champs absents à `null`. */
export function cardLine(c: CardRow): string {
  return JSON.stringify({
    at: isoMillis(c.updated_at),
    back: c.back,
    created_at: isoMillis(c.created_at),
    deck: c.deck,
    deleted_at: c.deleted_at === null ? null : isoMillis(c.deleted_at),
    front: c.front,
    id: c.id,
    source: c.source,
    source_path: c.source_path,
    source_title: c.source_title,
    status: c.status,
    tags: c.tags,
    v: FORMAT.version,
  })
}

/** Ligne de `reviews-AAAA-MM.jsonl`. La PWA ne garde pas le drapeau « révision libre » côté serveur : `free` à false. */
export function reviewLine(r: ReviewRow): string {
  if (![1, 2, 3].includes(r.rating)) throw new Error(`note inattendue pour la révision ${r.id} : ${r.rating}`)
  return JSON.stringify({ card_id: r.card_id, free: false, id: r.id, rating: r.rating, reviewed_at: isoMillis(r.reviewed_at), v: FORMAT.version })
}

/** Ordre stable des révisions : instant, puis id (comme la fusion). */
function byTime(a: ReviewRow, b: ReviewRow): number {
  const ta = isoMillis(a.reviewed_at), tb = isoMillis(b.reviewed_at)
  return ta < tb ? -1 : ta > tb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Fichiers du dossier de l'appareil d'export : `device.json`, `cards.jsonl` (une ligne par carte, supprimées et
 * brouillons compris) et un `reviews-AAAA-MM.jsonl` par mois UTC. Les révisions d'une carte absente sont refusées.
 */
export function deviceFiles(device: string, now: Date, cards: readonly CardRow[], reviews: readonly ReviewRow[]): OutFile[] {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(device)) throw new Error(`id d'appareil invalide : ${device}`)
  const ids = new Set(cards.map(c => c.id))
  const orphan = reviews.find(r => !ids.has(r.card_id))
  if (orphan) throw new Error(`révision ${orphan.id} d'une carte inconnue`)
  const dir = `devices/${device}`
  const files: OutFile[] = [
    { path: `${dir}/device.json`, contents: JSON.stringify({ created_at: now.toISOString(), id: device, name: DEVICE_NAME }) + '\n' },
  ]
  const sortedCards = [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (sortedCards.length > 0) files.push({ path: `${dir}/cards.jsonl`, contents: sortedCards.map(c => cardLine(c) + '\n').join('') })
  const months = new Map<string, string[]>()
  for (const r of [...reviews].sort(byTime)) {
    const month = isoMillis(r.reviewed_at).slice(0, 7)
    months.set(month, [...(months.get(month) ?? []), reviewLine(r) + '\n'])
  }
  for (const [month, lines] of [...months].sort(([a], [b]) => (a < b ? -1 : 1))) {
    files.push({ path: `${dir}/reviews-${month}.jsonl`, contents: lines.join('') })
  }
  return files
}

/**
 * `format.json` déjà présent : il doit être celui de Vault Cards, en version 1. Absent (null) : à créer.
 * Renvoie le fichier à écrire, ou null s'il n'y a rien à écrire.
 */
export function formatFile(existing: string | null): OutFile | null {
  if (existing === null) return { path: 'format.json', contents: JSON.stringify(FORMAT) + '\n' }
  let parsed: unknown
  try {
    parsed = JSON.parse(existing)
  } catch {
    throw new Error('format.json illisible dans le dossier VaultCards')
  }
  const f = parsed as { format?: unknown; version?: unknown }
  if (f.format !== FORMAT.format) throw new Error("ce dossier VaultCards n'est pas celui de Vault Cards")
  if (f.version !== FORMAT.version) throw new Error(`dossier VaultCards en version ${String(f.version)}, l'export écrit la version ${FORMAT.version}`)
  return null
}
