/**
 * Latte review index. Lists recent saturday_latte_issues rows with
 * approval status + slot-regen counts. Click through to per-issue
 * detail for image thumbnails + per-slot regen + approve/needs-work.
 *
 *   /admin/latte?test=<CRON_SECRET>
 */

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

function isAuthorized(test: string | undefined): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return test === cronSecret;
}

type Row = {
  issue_date: string;
  cover_story_headline: string;
  subject: string | null;
  approval_status: string | null;
  generated_at: string | null;
  sections: unknown;
};

export default async function LatteReviewIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const testParam = typeof sp.test === "string" ? sp.test : undefined;
  if (!isAuthorized(testParam)) {
    return (
      <main style={pageStyle}>
        <h1>Latte review</h1>
        <p>Unauthorized. Append <code>?test=&lt;CRON_SECRET&gt;</code>.</p>
      </main>
    );
  }

  const db = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("issue_date, cover_story_headline, subject, approval_status, generated_at, sections")
    .order("issue_date", { ascending: false })
    .limit(40);

  if (error) {
    return (
      <main style={pageStyle}>
        <h1>Latte review</h1>
        <p>Error: {error.message}</p>
      </main>
    );
  }

  const rows = ((data ?? []) as Row[]).map((row) => {
    const sections = (row.sections ?? {}) as Record<string, unknown>;
    const regenCount = Array.isArray(sections.slotRegenerations) ? (sections.slotRegenerations as unknown[]).length : 0;
    const pipelineVersion = typeof sections.pipelineVersion === "string" ? sections.pipelineVersion : "v1";
    const hasImages = !!(sections.images);
    return {
      issue_date: row.issue_date,
      headline: row.cover_story_headline,
      subject: row.subject,
      approval: row.approval_status ?? "pending",
      generated_at: row.generated_at,
      regenCount,
      pipelineVersion,
      hasImages,
    };
  });

  return (
    <main style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ marginBottom: 8 }}>Latte review</h1>
        <Link
          href={`/admin/latte/curated?test=${testParam}`}
          style={{ color: "#0a5fb8", fontSize: 13, textDecoration: "none", padding: "6px 12px", border: "1px solid #0a5fb8", borderRadius: 4 }}
        >
          ⭐ Curated lists →
        </Link>
      </div>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>
        Recent Saturday Morning Latte issues. Click a row to see per-slot images and regenerate anything that came out wrong.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #d5d8de", textAlign: "left" }}>
            <th style={cellStyle}>Date</th>
            <th style={cellStyle}>Pipeline</th>
            <th style={cellStyle}>Headline</th>
            <th style={cellStyle}>Approval</th>
            <th style={cellStyle}>Regens</th>
            <th style={cellStyle}>Images</th>
            <th style={cellStyle}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.issue_date} style={{ borderBottom: "1px solid #eef" }}>
              <td style={cellStyle}>{r.issue_date}</td>
              <td style={{ ...cellStyle, color: r.pipelineVersion === "v2" ? "#0a5fb8" : "#666" }}>{r.pipelineVersion}</td>
              <td style={cellStyle}>{r.headline}</td>
              <td style={cellStyle}>
                <span style={{
                  padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
                  ...(r.approval === "approved" ? { color: "#0a7f3f", backgroundColor: "#e6f5ec" }
                    : r.approval === "needs_work" ? { color: "#b8651a", backgroundColor: "#fdf1e5" }
                    : { color: "#666", backgroundColor: "#f0f0f2" }),
                }}>{r.approval}</span>
              </td>
              <td style={{ ...cellStyle, color: r.regenCount > 0 ? "#b8651a" : "#aaa" }}>{r.regenCount || "—"}</td>
              <td style={{ ...cellStyle, color: r.hasImages ? "#0a7f3f" : "#aaa" }}>{r.hasImages ? "✓" : "—"}</td>
              <td style={cellStyle}>
                <Link href={`/admin/latte/${r.issue_date}?test=${testParam}`} style={{ color: "#0a5fb8" }}>
                  review →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  maxWidth: 1200,
  margin: "0 auto",
};
const cellStyle: React.CSSProperties = { padding: "8px 6px", whiteSpace: "nowrap" };
