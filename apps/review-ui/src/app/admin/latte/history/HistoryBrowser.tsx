"use client";

import { useMemo, useState } from "react";

type Row = {
  id: string;
  kind: string;
  value: string;
  normalized_value: string;
  context: string | null;
  issue_date: string;
  created_at: string;
};

export function HistoryBrowser({
  rows,
  initialKind,
  initialQuery,
}: {
  rows: Row[];
  initialKind: string;
  initialQuery: string;
}) {
  const [kind, setKind] = useState<string>(initialKind || "all");
  const [query, setQuery] = useState<string>(initialQuery);

  const allKinds = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.kind);
    return Array.from(set).sort();
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (q && !r.value.toLowerCase().includes(q) && !r.normalized_value.includes(q)) return false;
      return true;
    });
  }, [rows, kind, query]);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 search value — e.g. 'wild turkey', 'porsche', 'baldwin'"
          autoFocus
          style={{ flex: "2 1 320px", minWidth: 240, padding: "8px 12px", border: "1px solid #d5d8de", borderRadius: 4, fontSize: 14 }}
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          style={{ padding: "8px 12px", border: "1px solid #d5d8de", borderRadius: 4, fontSize: 13 }}
        >
          <option value="all">all kinds ({rows.length})</option>
          {allKinds.map((k) => (
            <option key={k} value={k}>{k} ({counts[k]})</option>
          ))}
        </select>
        {query || kind !== "all" ? (
          <button
            type="button"
            onClick={() => { setQuery(""); setKind("all"); }}
            style={{ padding: "6px 10px", border: "1px solid #d5d8de", borderRadius: 4, background: "#fff", cursor: "pointer", fontSize: 12 }}
          >clear</button>
        ) : null}
      </div>

      <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>
        {filtered.length} of {rows.length} rows shown{query ? ` — matching "${query}"` : ""}{kind !== "all" ? ` in ${kind}` : ""}.
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #d5d8de", textAlign: "left" }}>
            <th style={cellStyle}>Kind</th>
            <th style={cellStyle}>Value</th>
            <th style={cellStyle}>First seen</th>
            <th style={cellStyle}>Context</th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, 500).map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eef" }}>
              <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
                <span style={pillStyle(r.kind)}>{r.kind}</span>
              </td>
              <td style={cellStyle}>{r.value}</td>
              <td style={{ ...cellStyle, whiteSpace: "nowrap", color: "#666", fontSize: 12 }}>{r.issue_date}</td>
              <td style={{ ...cellStyle, color: "#888", fontSize: 11 }}>{r.context ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 500 ? (
        <div style={{ fontSize: 12, color: "#888", marginTop: 8 }}>Showing the first 500. Refine the search to narrow down.</div>
      ) : null}
    </div>
  );
}

const cellStyle: React.CSSProperties = { padding: "8px 6px", verticalAlign: "top" };

function pillStyle(kind: string): React.CSSProperties {
  const palette: Record<string, string> = {
    car: "#0a5fb8",
    book: "#7a4a1a",
    film: "#8b1e5f",
    album: "#0a7f3f",
    podcast: "#0a7f3f",
    drink: "#b8651a",
    drink_brand: "#b8651a",
    product: "#4a4540",
    product_brand: "#4a4540",
    destination: "#1a6b7a",
    restaurant: "#c22",
    dish: "#a52a2a",
    cooking_move: "#5a3a1a",
  };
  const color = palette[kind] ?? "#666";
  return {
    display: "inline-block", padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 600,
    color, backgroundColor: `${color}18`,
  };
}
