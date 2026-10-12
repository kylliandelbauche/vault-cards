import { createClient } from '@supabase/supabase-js'
import type { Database } from './supabase-types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Configuration Supabase manquante')

export const supabase = createClient<Database>(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
})
