import { createClient } from '@supabase/supabase-js'
import type { Database } from './supabase-types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Configuration Supabase manquante')

// Clé de stockage explicite : useAuth doit pouvoir effacer la session locale lui-même
// quand signOut() échoue hors ligne (supabase-js garde alors la session en stockage).
export const AUTH_STORAGE_KEY = 'vault-cards-auth'

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
})
