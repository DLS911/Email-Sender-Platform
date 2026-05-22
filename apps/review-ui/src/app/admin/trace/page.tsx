/**
 * Pipeline Trace Index
 *
 * Lists recent issues with quick links to their full pipeline trace.
 * Drift count is surfaced inline so you can scan for issues that broke
 * before drilling in.
 *
 *   /admin/trace?test=<CRON_SECRET>
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
  headline: string;
  generation_meta: unknown;
};

export default async function TraceIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const testParam = typeof sp.test === "string" ? sp.test : undefined;

  if (!isAuthorized(testParam)) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <h1>Pipeline trace</h1>
        <p>
          Unauthorized. Append <code>?test=&lt;CRON_SECRET&gt;</code> to the URL.
        </p>
      </main>
    );
  }

  const db = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline, generation_meta")
    .order("issue_date", { ascending: false })
    .limit(30);

  if (error) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <h1>Pipeline trace</h1>
        <p>Error: {error.message}</p>
      </main>
    );
  }

  const rows = ((data ?? []) as Row[]).map((row) => {
    const meta = (row.generation_meta ?? {}) as Record<string, unknown>;
    const pipeline = meta.pipeline;
    let driftCount = 0;
    let stageCount = 0;
    let hasTrace = false;
    if (Array.isArray(pipeline)) {
      hasTrace = true;
      stageCount = pipeline.length;
      const drift = (pipeline as Array<{ name: string; output?: Record<string, unknown> }>).find(
        (s) => s.name === "pipeline_drift_check",
      );
      if (drift && Array.isArray(drift.output?.flags)) {
        driftCount = (drift.output!.flags as unknown[]).length;
      }
    }
    const qualityGateStatus =
      meta.qualityGateStatus === "passed" || meta.qualityGateStatus === "pending_review_with_warnings"
        ? (meta.qualityGateStatus as "passed" | "pending_review_with_warnings")
        : null;
    const qualityGateWarningCount = Array.isArray(meta.qualityGateWarnings)
      ? (meta.qualityGateWarnings as unknown[]).length
      : 0;
    return {
      issue_date: row.issue_date,
      headline: row.headline,
      contentType: typeof meta.contentType === "string" ? meta.contentType : null,
      cluster: (() => {
        const summary = meta.issueSummary as Record<string, unknown> | undefined;
        return summary && typeof summary.cluster === "string" ? summary.cluster : null;
      })(),
      hasTrace,
      stageCount,
      driftCount,
      qualityGateStatus,
      qualityGateWarningCount,
    };
  });

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Pipeline trace</h1>
      <p style={{ color: "#666", fontSize: 14, marginBottom: 24 }}>
        Per-issue handoff trace: see what each block received and what it produced. Drift flags
        surface stages where the upstream contract was not honored.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #d5d8de", textAlign: "left" }}>
            <th style={{ padding: "8px 6px" }}>Date</th>
            <th style={{ padding: "8px 6px" }}>Type</th>
            <th style={{ padding: "8px 6px" }}>Cluster</th>
            <th style={{ padding: "8px 6px" }}>Headline</th>
            <th style={{ padding: "8px 6px" }}>Stages</th>
            <th style={{ padding: "8px 6px" }}>Drift</th>
            <th style={{ padding: "8px 6px" }}>Quality Gate</th>
            <th style={{ padding: "8px 6px" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.issue_date} style={{ borderBottom: "1px solid #eef" }}>
              <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{r.issue_date}</td>
              <td style={{ padding: "8px 6px", color: "#666" }}>{r.contentType ?? "—"}</td>
              <td style={{ padding: "8px 6px", color: "#666" }}>{r.cluster ?? "—"}</td>
              <td style={{ padding: "8px 6px" }}>{r.headline}</td>
              <td style={{ padding: "8px 6px", color: "#666" }}>
                {r.hasTrace ? r.stageCount : <span style={{ color: "#aaa" }}>no trace</span>}
              </td>
              <td style={{ padding: "8px 6px" }}>
                {r.driftCount === 0 ? (
                  r.hasTrace ? (
                    <span style={{ color: "#0a7f3f" }}>clean</span>
                  ) : (
                    <span style={{ color: "#aaa" }}>—</span>
                  )
                ) : (
                  <span style={{ color: "#b8651a", fontWeight: 600 }}>⚠ {r.driftCount}</span>
                )}
              </td>
              <td style={{ padding: "8px 6px" }}>
                {r.qualityGateStatus === "passed" ? (
                  <span style={{ color: "#0a7f3f" }}>passed</span>
                ) : r.qualityGateStatus === "pending_review_with_warnings" ? (
                  <span style={{ color: "#b8651a", fontWeight: 600 }}>
                    ⚠ pending review ({r.qualityGateWarningCount})
                  </span>
                ) : (
                  <span style={{ color: "#aaa" }}>—</span>
                )}
              </td>
              <td style={{ padding: "8px 6px" }}>
                {r.hasTrace ? (
                  <Link
                    href={`/admin/trace/${r.issue_date}?test=${testParam}` as never}
                    style={{ color: "#0a5fb8" }}
                  >
                    view →
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
