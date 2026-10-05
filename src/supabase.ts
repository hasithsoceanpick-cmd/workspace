import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

export const isConfigured = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Turn a Supabase/Postgres error into a short, human message. */
export function niceError(e: unknown): string {
  const msg = (e as { message?: string })?.message || String(e);
  if (/row-level security/i.test(msg)) return "You don't have permission to do that.";
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/already registered|already been registered/i.test(msg)) return 'That email already has an account — sign in instead.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return "Can't reach the server. Check your connection.";
  return msg;
}
