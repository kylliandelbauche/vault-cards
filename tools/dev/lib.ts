import { parseEnv } from 'node:util'

/** Les deux seules valeurs que lit rest-check : la configuration publique de l'app (exposée au navigateur). */
export interface PublicConfig { url: string; key: string }

export const PUBLIC_VARS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const

const PUBLIC_LINE = /^\s*VITE_SUPABASE_(URL|PUBLISHABLE_KEY)\s*=/

/**
 * Lignes `VITE_SUPABASE_URL=` et `VITE_SUPABASE_PUBLISHABLE_KEY=` d'un fichier env, et rien d'autre. Le tri se fait
 * sur le texte brut, avant tout parse : les autres lignes (dont la clé secrète) ne sont ni analysées ni conservées.
 */
export function publicLines(fileContents: string): string {
  return fileContents.split(/\r?\n/).filter(l => PUBLIC_LINE.test(l)).join('\n')
}

/**
 * Configuration publique : variables d'environnement `VITE_…` d'abord, sinon les deux lignes publiques d'un fichier env
 * (`.env.local`, comme `npm run dev`), filtrées par publicLines avant le parse. La clé secrète n'est jamais analysée,
 * copiée dans process.env ni affichée.
 */
export function pickPublicConfig(env: Record<string, string | undefined>, fileContents: string | null): PublicConfig {
  const fromFile = fileContents === null ? {} : parseEnv(publicLines(fileContents))
  const get = (name: (typeof PUBLIC_VARS)[number]) => env[name] || fromFile[name] || ''
  const url = get('VITE_SUPABASE_URL')
  const key = get('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (!url || !key) throw new Error(`configuration publique manquante : ${PUBLIC_VARS.join(' et ')} (variables d'environnement ou .env.local)`)
  assertPublishableKey(key)
  return { url, key }
}

/** Garde-fou : refuse une clé secrète (sb_secret_…) ou un ancien JWT service_role passé par erreur. */
export function assertPublishableKey(key: string): void {
  if (key.startsWith('sb_secret_')) throw new Error('clé secrète détectée dans VITE_SUPABASE_PUBLISHABLE_KEY : refus (seule la clé publishable est admise)')
  const parts = key.split('.')
  if (parts.length === 3) {
    try {
      const payload: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      if (payload && typeof payload === 'object' && 'role' in payload && payload.role !== 'anon') {
        throw new Error('clé JWT non anonyme détectée : refus (seule la clé publishable est admise)')
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('refus')) throw e
      // JWT illisible : ce n'est pas un JWT service_role reconnaissable, on laisse l'API trancher.
    }
  }
}

export interface StepResult {
  step: string
  expected: string
  /** Statut HTTP renvoyé par l'API (0 = pas de réponse HTTP). */
  status: number
  got: string
  ok: boolean
}

/** Tableau texte aligné : étape → attendu → HTTP → obtenu → ✓/✗, puis le verdict. */
export function formatTable(rows: StepResult[]): string {
  const head = ['#', 'Étape', 'Attendu', 'HTTP', 'Obtenu', '']
  const lines = rows.map((r, i) => [String(i + 1), r.step, r.expected, r.status ? String(r.status) : '—', r.got, r.ok ? '✓' : '✗'])
  const width = head.map((h, c) => Math.max(h.length, ...lines.map(l => l[c].length)))
  const fmt = (cells: string[]) => cells.map((cell, c) => cell.padEnd(width[c])).join(' │ ').trimEnd()
  const failed = rows.filter(r => !r.ok).length
  return [
    fmt(head),
    width.map(w => '─'.repeat(w)).join('─┼─'),
    ...lines.map(fmt),
    '',
    failed === 0 ? `Résultat : ${rows.length}/${rows.length} conformes ✓` : `Résultat : ${failed} écart(s) sur ${rows.length} ✗`,
  ].join('\n')
}

/** Réponse PostgREST minimale (supabase-js) : données, erreur, statut HTTP. */
export interface ApiResponse { data: unknown; error: { message: string; code?: string } | null; status: number }

const rowsOf = (r: ApiResponse) => (Array.isArray(r.data) ? r.data.length : r.data ? 1 : 0)

/** Succès attendu avec exactement `n` lignes renvoyées. */
export function expectRows(step: string, expected: string, r: ApiResponse, n: number, extra = true): StepResult {
  const got = r.error ? `erreur ${r.error.code ?? ''} ${r.error.message}`.replace(/\s+/g, ' ') : `${rowsOf(r)} ligne(s)`
  return { step, expected, status: r.status, got, ok: !r.error && rowsOf(r) === n && extra }
}

/** Refus attendu : une erreur PostgreSQL 42501 (droit ou RLS) et un statut HTTP 401/403. */
export function expectDenied(step: string, r: ApiResponse): StepResult {
  const got = r.error ? `refus ${r.error.code ?? ''} ${r.error.message}`.replace(/\s+/g, ' ') : `accepté (${rowsOf(r)} ligne(s))`
  return { step, expected: 'refusé (42501)', status: r.status, got, ok: r.error?.code === '42501' && (r.status === 401 || r.status === 403) }
}

/**
 * Saisie masquée, touche par touche (mode brut du terminal) : Entrée valide, Ctrl-C annule, retour arrière efface.
 * Les séquences d'échappement (flèches, touches de fonction : ESC [ … ou ESC O x) et les autres caractères de
 * contrôle sont ignorés : ils ne finissent jamais dans le mot de passe.
 */
export function typeKeys(value: string, input: string): { value: string; done: 'enter' | 'cancel' | null } {
  const chars = Array.from(input)
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === '\r' || ch === '\n') return { value, done: 'enter' }
    if (ch === '\u0003') return { value, done: 'cancel' }
    if (ch === '\u007f' || ch === '\b') { value = Array.from(value).slice(0, -1).join(''); continue }
    if (ch === '\u001b') {
      const next = chars[i + 1]
      if (next === '[') { // CSI : paramètres puis un octet final entre @ et ~
        i += 2
        while (i < chars.length && !(chars[i] >= '@' && chars[i] <= '~')) i++
      } else if (next === 'O') i += 2 // SS3 : ESC O + une lettre
      else if (next !== undefined) i += 1 // ESC + une touche (Alt)
      continue
    }
    if (ch < ' ') continue
    value += ch
  }
  return { value, done: null }
}
