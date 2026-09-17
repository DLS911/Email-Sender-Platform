"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  id: string;
  brand: string;
  issue_date: string;
  version_seq: number;
  subject: string | null;
  headline: string | null;
  preheader: string | null;
  source: string;
  source_note: string | null;
  preview_resend_id: string | null;
  ac_campaign_id: string | null;
  ac_message_id: string | null;
  created_at: string;
};

type Props = {
  brand: "latte" | "daily-grind";
  issueDate: string;
  testSecret: string;
};

const SOURCE_LABELS: Record<string, string> = {
  generate: "generate",
  regenerate_slot: "regen slot",
  rewrite_passage: "rewrite passage",
  rewrite_issue: "rewrite issue",
};

/**
 * Collapsible panel that lists every saved version of this issue —
 * every generation, every regen, every rewrite. Click a row to open
 * the full rendered HTML preview in a new tab (fetched by id).
 */
export function VersionHistory({ brand, issueDate, testSecret }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        brand,
        issueDate,
        limit: "50",
        test: testSecret,
      });
      const res = await fetch(`/api/admin/issue-versions?${q.toString()}`);
      const data = (await res.json()) as { versions?: Row[]; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setRows(data.versions ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [brand, issueDate, testSecret]);

  useEffect(() => {
    if (open && rows === null) void load();
  }, [open, rows, load]);

  const viewVersion = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/admin/issue-versions?id=${id}&test=${encodeURIComponent(testSecret)}`);
      const data = (await res.json()) as { version?: { html?: string }; error?: string };
      if (data.error || !data.version?.html) {
        window.alert(`Failed to load version: ${data.error ?? "no html"}`);
        return;
      }
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(data.version.html);
      w.document.close();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err));
    }
  }, [testSecret]);

  return (
    <section style={{ marginTop: 24 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", padding: "12px 16px", background: open ? "#f0f4f9" : "#fafafa",
          border: "1px solid #d5d8de", borderRadius: 6, cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 15, fontWeight: 600, color: "#333", textAlign: "left",
        }}
      >
        <span>🗄️ Version history — every saved copy of this issue</span>
        <span style={{ fontSize: 12, color: "#666", fontWeight: 400 }}>
          {rows ? `${rows.length} version${rows.length === 1 ? "" : "s"}` : ""} · {open ? "hide ▲" : "show ▼"}
        </span>
      </button>

      {open ? (
        <div style={{ marginTop: 12, padding: 16, border: "1px solid #eef", borderRadius: 6, background: "#fff" }}>
          {loading ? <p style={{ fontSize: 13, color: "#666" }}>loading…</p> : null}
          {error ? <p style={{ fontSize: 13, color: "#c22" }}>err: {error}</p> : null}
          {rows && rows.length === 0 ? (
            <p style={{ fontSize: 13, color: "#666" }}>
              No versions stored yet. New generations and edits will start showing here.
            </p>
          ) : null}
          {rows && rows.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#666", borderBottom: "1px solid #e5e5e5" }}>
                  <th style={{ padding: "6px 8px", width: 60 }}>#</th>
                  <th style={{ padding: "6px 8px", width: 140 }}>saved at</th>
                  <th style={{ padding: "6px 8px", width: 130 }}>source</th>
                  <th style={{ padding: "6px 8px" }}>subject / note</th>
                  <th style={{ padding: "6px 8px", width: 90 }}>preview</th>
                  <th style={{ padding: "6px 8px", width: 90 }}>ac push</th>
                  <th style={{ padding: "6px 8px", width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f2f2f2" }}>
                    <td style={{ padding: "6px 8px", color: "#999" }}>v{r.version_seq}</td>
                    <td style={{ padding: "6px 8px", color: "#555", fontFamily: "SF Mono, monospace", fontSize: 11 }}>
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <span style={{ padding: "2px 6px", borderRadius: 3, background: "#f0f4f9", fontSize: 11, color: "#555" }}>
                        {SOURCE_LABELS[r.source] ?? r.source}
                      </span>
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <div style={{ fontWeight: 500, color: "#222" }}>{r.subject ?? r.headline ?? "—"}</div>
                      {r.source_note ? (
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{r.source_note}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: r.preview_resend_id ? "#0a7f3f" : "#aaa" }}>
                      {r.preview_resend_id ? "✓ sent" : "—"}
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 11, color: r.ac_campaign_id ? "#0a5fb8" : "#aaa" }}>
                      {r.ac_campaign_id ? `#${r.ac_campaign_id}` : "—"}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <button
                        type="button"
                        onClick={() => viewVersion(r.id)}
                        style={{ padding: "3px 8px", background: "#f7fafc", border: "1px solid #cbd5e0", borderRadius: 3, cursor: "pointer", fontSize: 11, color: "#2b6cb0" }}
                      >
                        view →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
