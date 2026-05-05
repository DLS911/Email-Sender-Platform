/**
 * Placeholder Database type. Replace with output of `supabase gen types typescript`
 * once the Supabase project is provisioned and migrations have been applied.
 *
 * The migrations live in infra/supabase/migrations/.
 *
 * Until then we manually declare the few tables app code reads at boot
 * (platform_config) so type-checking succeeds.
 */
export type Database = {
  public: {
    Tables: {
      platform_config: {
        Row: {
          id: string;
          key: string;
          brand_id: string | null;
          environment: string;
          value: unknown;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          key: string;
          brand_id?: string | null;
          environment: string;
          value: unknown;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<{
          id: string;
          key: string;
          brand_id: string | null;
          environment: string;
          value: unknown;
          updated_at: string;
          updated_by: string | null;
        }>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      pg_advisory_lock: { Args: { key: number }; Returns: undefined };
      pg_advisory_unlock: { Args: { key: number }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
