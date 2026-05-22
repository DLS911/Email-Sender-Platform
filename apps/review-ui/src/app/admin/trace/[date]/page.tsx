/**
 * Pipeline Trace Viewer
 *
 * Renders the full per-issue pipeline trace as INPUT → OUTPUT per stage.
 * Drift between stages (e.g. proposer aimed for prospecting-prep, summary
 * landed on m-and-a-buyer-vetting) is surfaced with red flags so it's
 * obvious where the break happened.
 *
 * Access:
 *   /admin/trace/2026-05-21?test=<CRON_SECRET>
 *
 * The page server-fetches the data via the /api/admin/issue-trace route,
 * so the CRON_SECRET query param is the only auth needed.
 */

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

export const dynamic = "force-dynamic";

type StageRecord = {
  name: string;
  status: "success" | "skipped" | "failed" | "retried" | "warning";
  latencyMs?: number;
  notes?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

type DriftFlag = {
  code: string;
  fromStage: string;
  toStage: string;
  detail: string;
};

function isAuthorized(test: string | undefined): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return test === cronSecret;
}

async function loadTrace(date: string): Promise<{
  issueDate: string;
  headline: string;
  pipeline: StageRecord[] | null;
  issueSummary: Record<string, unknown> | null;
  contentType: string | null;
} | null> {
  const db = createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, headline, generation_meta")
    .eq("issue_date", date)
    .maybeSingle();
  if (error || !data) return null;
  const meta = (data.generation_meta ?? {}) as Record<string, unknown>;
  return {
    issueDate: data.issue_date,
    headline: data.headline,
    pipeline: (meta.pipeline as StageRecord[] | undefined) ?? null,
    issueSummary: (meta.issueSummary as Record<string, unknown> | undefined) ?? null,
    contentType: typeof meta.contentType === "string" ? meta.contentType : null,
  };
}

function statusColor(status: StageRecord["status"]): string {
  switch (status) {
    case "success":
      return "#0a7f3f";
    case "warning":
      return "#b8651a";
    case "failed":
      return "#b81a1a";
    case "skipped":
      return "#888";
    case "retried":
      return "#6a4a8f";
    default:
      return "#444";
  }
}

function KeyValueBlock({ obj }: { obj: Record<string, unknown> | undefined }) {
  if (!obj || Object.keys(obj).length === 0) {
    return <div style={{ color: "#aaa", fontStyle: "italic" }}>—</div>;
  }
  return (
    <pre
      style={{
        background: "#0e1116",
        color: "#cde",
        padding: "10px 12px",
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.45,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
      }}
    >
      {JSON.stringify(obj, null, 2)}
    </pre>
  );
}

export default async function TracePage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { date } = await params;
  const sp = await searchParams;
  const testParam = typeof sp.test === "string" ? sp.test : undefined;

  if (!isAuthorized(testParam)) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <h1>Pipeline trace</h1>
        <p>Unauthorized. Append <code>?test=&lt;CRON_SECRET&gt;</code> to the URL.</p>
      </main>
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <h1>Pipeline trace</h1>
        <p>Malformed date: <code>{date}</code>. Expected YYYY-MM-DD.</p>
      </main>
    );
  }

  const trace = await loadTrace(date);
  if (!trace) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <h1>Pipeline trace — {date}</h1>
        <p>No issue persisted for this date.</p>
      </main>
    );
  }

  const driftStage = trace.pipeline?.find((s) => s.name === "pipeline_drift_check");
  const driftFlags: DriftFlag[] = Array.isArray(driftStage?.output?.flags)
    ? (driftStage!.output!.flags as DriftFlag[])
    : [];

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        maxWidth: 1100,
        margin: "0 auto",
      }}
    >
      <Link href={`/admin/trace?test=${testParam}` as never} style={{ fontSize: 13, color: "#888" }}>
        ← back to trace index
      </Link>
      <h1 style={{ marginTop: 8, marginBottom: 4 }}>Pipeline trace — {trace.issueDate}</h1>
      <div style={{ fontSize: 14, color: "#444", marginBottom: 8 }}>
        <strong>Final headline:</strong> {trace.headline}
      </div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 24 }}>
        <strong>Content type:</strong> {trace.contentType ?? "—"}
        {trace.issueSummary && typeof trace.issueSummary.cluster === "string" ? (
          <> · <strong>Cluster (per issue_summary):</strong> {String(trace.issueSummary.cluster)}</>
        ) : null}
      </div>

      {driftFlags.length > 0 ? (
        <div
          style={{
            background: "#fff3e0",
            border: "1px solid #ff9800",
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <strong style={{ color: "#b8651a" }}>⚠ Drift detected ({driftFlags.length})</strong>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20 }}>
            {driftFlags.map((flag, i) => (
              <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>
                <code style={{ background: "#fff", padding: "1px 4px", borderRadius: 3 }}>{flag.code}</code>{" "}
                <span style={{ color: "#666" }}>
                  ({flag.fromStage} → {flag.toStage})
                </span>
                : {flag.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : trace.pipeline ? (
        <div
          style={{
            background: "#e8f5e9",
            border: "1px solid #4caf50",
            padding: "10px 14px",
            borderRadius: 8,
            marginBottom: 24,
            fontSize: 13,
            color: "#0a7f3f",
          }}
        >
          ✓ No drift detected. All handoffs honored.
        </div>
      ) : null}

      {!trace.pipeline ? (
        <p style={{ color: "#888" }}>
          No pipeline trace was persisted for this issue. This issue was likely generated before the trace persistence layer was deployed.
        </p>
      ) : (
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {trace.pipeline.map((stage, i) => {
            const isGate = stage.name.endsWith("_gate") || stage.name === "pipeline_drift_check";
            return (
            <li
              key={i}
              style={{
                marginBottom: 18,
                border: isGate ? "2px solid #5a7fb8" : "1px solid #d5d8de",
                borderLeft: `4px solid ${statusColor(stage.status)}`,
                borderRadius: 6,
                background: isGate ? "#f0f5fc" : "#fafbfc",
              }}
            >
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid #e5e8ee",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 12,
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {i + 1}. {stage.name}
                  </span>
                  {isGate ? (
                    <span style={{ marginLeft: 8, fontSize: 10, background: "#5a7fb8", color: "white", padding: "2px 6px", borderRadius: 3, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      gate
                    </span>
                  ) : null}
                  <span style={{ marginLeft: 10, fontSize: 12, color: statusColor(stage.status) }}>
                    {stage.status}
                  </span>
                  {typeof stage.latencyMs === "number" ? (
                    <span style={{ marginLeft: 10, fontSize: 12, color: "#888" }}>
                      {(stage.latencyMs / 1000).toFixed(1)}s
                    </span>
                  ) : null}
                </div>
              </div>
              {stage.notes ? (
                <div style={{ padding: "8px 14px", fontSize: 13, color: "#555", borderBottom: "1px solid #eef" }}>
                  {stage.notes}
                </div>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#e5e8ee" }}>
                <div style={{ background: "#fff", padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
                    INPUT (received from prior stage)
                  </div>
                  <KeyValueBlock obj={stage.input} />
                </div>
                <div style={{ background: "#fff", padding: "10px 14px" }}>
                  <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>
                    {isGate ? "DECISION (what the gate chose)" : "OUTPUT (passed downstream)"}
                  </div>
                  <KeyValueBlock obj={stage.output} />
                </div>
              </div>
            </li>
          );
          })}
        </ol>
      )}
    </main>
  );
}
