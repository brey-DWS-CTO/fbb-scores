import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let supabaseServer: SupabaseClient<Database> | null = null

if (supabaseUrl && supabaseServiceRoleKey) {
  supabaseServer = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
} else {
  console.warn('[Supabase] Missing env vars — snapshots disabled')
}

export { supabaseServer }
