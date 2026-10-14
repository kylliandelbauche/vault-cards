// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { assertPublishableKey, expectDenied, expectRows, formatTable, pickPublicConfig } from './lib.ts'

const jwt = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

describe('pickPublicConfig', () => {
  it('ne prend que les deux variables VITE_ du fichier, jamais la clé secrète', () => {
    const file = 'VITE_SUPABASE_URL=https://p.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc\nSUPABASE_SECRET_KEY=sb_secret_zzz\n'
    const cfg = pickPublicConfig({}, file)
    expect(cfg).toEqual({ url: 'https://p.supabase.co', key: 'sb_publishable_abc' })
    expect(JSON.stringify(cfg)).not.toContain('sb_secret')
  })

  it('les variables d’environnement priment ; rien du tout → erreur claire', () => {
    expect(pickPublicConfig({ VITE_SUPABASE_URL: 'https://e', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e' }, 'VITE_SUPABASE_URL=https://f')).toEqual({ url: 'https://e', key: 'sb_publishable_e' })
    expect(() => pickPublicConfig({}, null)).toThrow('configuration publique manquante')
  })
})

describe('assertPublishableKey', () => {
  it('refuse une clé secrète ou un JWT service_role, accepte publishable et JWT anon', () => {
    expect(() => assertPublishableKey('sb_secret_abc')).toThrow('refus')
    expect(() => assertPublishableKey(jwt({ role: 'service_role' }))).toThrow('refus')
    expect(() => assertPublishableKey('sb_publishable_abc')).not.toThrow()
    expect(() => assertPublishableKey(jwt({ role: 'anon' }))).not.toThrow()
  })
})

describe('verdicts', () => {
  it('expectRows : succès avec le bon nombre de lignes', () => {
    expect(expectRows('lire', '1 ligne', { data: [{}], error: null, status: 200 }, 1).ok).toBe(true)
    expect(expectRows('lire', '1 ligne', { data: [], error: null, status: 200 }, 1).ok).toBe(false)
    expect(expectRows('lire', '1 ligne', { data: null, error: { message: 'x' }, status: 400 }, 1).ok).toBe(false)
  })

  it('expectDenied : seul un refus 42501 en 401/403 est conforme ; un update sans effet ne l’est pas', () => {
    expect(expectDenied('delete', { data: null, error: { code: '42501', message: 'permission denied' }, status: 403 }).ok).toBe(true)
    expect(expectDenied('delete', { data: [], error: null, status: 200 }).ok).toBe(false)
    expect(expectDenied('delete', { data: null, error: { code: '23514', message: 'check' }, status: 400 }).ok).toBe(false)
  })

  it('formatTable : une ligne par étape et le verdict', () => {
    const out = formatTable([
      { step: 'a', expected: 'x', status: 201, got: '1 ligne(s)', ok: true },
      { step: 'b', expected: 'refusé (42501)', status: 0, got: 'accepté', ok: false },
    ])
    expect(out).toContain('│ 201')
    expect(out).toContain('│ —')
    expect(out).toMatch(/Résultat : 1 écart\(s\) sur 2 ✗$/)
  })
})
