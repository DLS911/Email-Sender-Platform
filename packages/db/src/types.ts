/**
 * Placeholder Database type. Replace with output of `supabase gen types typescript`
 * once the Supabase project is provisioned and migrations have been applied.
 *
 * The migrations live in infra/supabase/migrations/.
 */
export type Database = {
  public: {
    Tables: Record<string, { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown> }>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
