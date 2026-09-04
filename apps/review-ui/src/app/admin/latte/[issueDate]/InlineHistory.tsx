"use client";

import { useState } from "react";
import { HistoryBrowser } from "../history/HistoryBrowser";

type Row = {
  id: string;
  kind: string;
  value: string;
  normalized_value: string;
  context: string | null;
  issue_date: string;
  created_at: string;
};

export function InlineHistory({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section style={{ marginTop: 32 }}>
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
        <span>📜 Recommendation history — search past picks to check for repeats</span>
        <span style={{ fontSize: 12, color: "#666", fontWeight: 400 }}>
          {rows.length} rows · {open ? "hide ▲" : "show ▼"}
        </span>
      </button>
      {open ? (
        <div style={{ marginTop: 12, padding: 16, border: "1px solid #eef", borderRadius: 6, background: "#fff" }}>
          <HistoryBrowser rows={rows} initialKind="" initialQuery="" />
        </div>
      ) : null}
    </section>
  );
}
