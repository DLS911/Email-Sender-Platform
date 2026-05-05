import { ConfigError } from "@platform/schemas";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import type { Database } from "./types.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new ConfigError(`missing env var: ${name}`, { context: { name } });
  }
  return v;
}

/**
 * Server-side authenticated client. Uses anon key + a user JWT.
 * RLS applies — queries only see what the user can see.
 */
export function createServerClient(jwt: string): SupabaseClient<Database> {
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  return createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

/**
 * Service-role client. BYPASSES RLS. Only use in trusted server-side code
 * (the pipeline worker, the webhook handler). NEVER expose to the browser.
 */
export function createServiceRoleClient(): SupabaseClient<Database> {
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
