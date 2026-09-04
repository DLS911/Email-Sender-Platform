/**
 * Latte recommendations history page. Shows every row ever recorded
 * to latte_recommendations so a reviewer can verify a pick isn't a
 * repeat. Grouped by kind (car, book, film, drink, product, etc.)
 * with a client-side search filter for fast "is this in there?"
 * lookups.
 *
 *   /admin/latte/history?test=<CRON_SECRET>
 *   /admin/latte/history?test=<CRON_SECRET>&kind=drink        (jump to a kind)
 *   /admin/latte/history?test=<CRON_SECRET>&q=highland+park   (pre-filter search)
 */

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { HistoryBrowser } from "./HistoryBrowser";

export const dynamic = "force-dynamic";

function isAuthorized(test: string | undefined): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return test === cronSecret;
}

type Row = {
  id: string;
  kind: string;
  value: string;
  normalized_value: string;
  context: string | null;
  issue_date: string;
  created_at: string;
};

export default async function LatteHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const testParam = typeof sp.test === "string" ? sp.test : undefined;
  const initialKind = typeof sp.kind === "string" ? sp.kind : "";
  const initialQuery = typeof sp.q === "string" ? sp.q : "";
  if (!isAuthorized(testParam)) {
    return (
      <main style={pageStyle}>
        <h1>Latte recommendation history</h1>
        <p>Unauthorized. Append <code>?test=&lt;CRON_SECRET&gt;</code>.</p>
      </main>
    );
  }

  const db = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
  const { data, error } = await db
    .from("latte_recommendations")
    .select("id, kind, value, normalized_value, context, issue_date, created_at")
    .eq("brand", "saturday_latte")
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) {
    return (
      <main style={pageStyle}>
        <h1>Latte recommendation history</h1>
        <p style={{ color: "#c22" }}>Error: {error.message}</p>
      </main>
    );
  }

  const rows = (data ?? []) as Row[];
  const grouped: Record<string, Row[]> = {};
  for (const r of rows) {
    grouped[r.kind] = grouped[r.kind] ?? [];
    grouped[r.kind]!.push(r);
  }
  const counts = Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length]));

  return (
    <main style={pageStyle}>
      <Link href={`/admin/latte?test=${testParam}`} style={{ color: "#0a5fb8", fontSize: 13, textDecoration: "none" }}>
        ← issues
      </Link>
      <h1 style={{ margin: "8px 0 4px 0" }}>Recommendation history</h1>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 24px 0" }}>
        Every item the writer has ever recommended, pulled from <code>latte_recommendations</code>. Use the search to quickly check whether a specific pick has been used before. {rows.length} total rows across {Object.keys(counts).length} kinds.
      </p>
      <HistoryBrowser rows={rows} initialKind={initialKind} initialQuery={initialQuery} />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  maxWidth: 1100,
  margin: "0 auto",
};
