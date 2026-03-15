import { createClient } from '@supabase/supabase-js'
import type { Database } from './types.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Missing Supabase server environment variables')
}

// Service role client — never expose to the browser; server-side use only
export const supabaseServer = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    // Disable auto token refresh and session persistence — not needed server-side
    autoRefreshToken: false,
    persistSession: false,
  },
})
