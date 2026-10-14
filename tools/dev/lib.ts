import { parseEnv } from 'node:util'

/** Les deux seules valeurs que lit rest-check : la configuration publique de l'app (exposée au navigateur). */
export interface PublicConfig { url: string; key: string }

export const PUBLIC_VARS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const

/**
 * Configuration publique : variables d'environnement `VITE_…` d'abord, sinon les mêmes lignes d'un fichier env
 * (`.env.local`, comme `npm run dev`). Seules ces deux clés sont extraites du fichier : la clé secrète qu'il contient
 * n'est jamais copiée dans process.env ni ailleurs.
 */
export function pickPublicConfig(env: Record<string, string | undefined>, fileContents: string | null): PublicConfig {
  const fromFile = fileContents === null ? {} : parseEnv(fileContents)
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
