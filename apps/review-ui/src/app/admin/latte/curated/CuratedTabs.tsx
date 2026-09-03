"use client";

import { useCallback, useEffect, useState } from "react";

type Kind = "car" | "drink" | "book" | "product";
const KINDS: Array<{ id: Kind; label: string; placeholder: string }> = [
  { id: "car", label: "Cars", placeholder: '1995 Porsche 993 Carrera' },
  { id: "drink", label: "Drinks", placeholder: "Elmer T. Lee Single Barrel Bourbon" },
  { id: "book", label: "Books", placeholder: "The Fire Next Time by James Baldwin" },
  { id: "product", label: "Products", placeholder: "Fellow Ode Brew Grinder Gen 2" },
];

type Item = {
  id: string;
  kind: Kind;
  title: string;
  notes: string | null;
  reference_url: string | null;
  status: "active" | "used" | "archived";
  used_in_issue_date: string | null;
  created_at: string;
};

type Grouped = Record<Kind, Item[]>;

export function CuratedTabs({ testSecret }: { testSecret: string }) {
  const [tab, setTab] = useState<Kind>("car");
  const [items, setItems] = useState<Grouped>({ car: [], drink: [], book: [], product: [] });
  const [statusFilter, setStatusFilter] = useState<"active" | "used" | "archived" | "all">("active");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addTitle, setAddTitle] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addRefUrl, setAddRefUrl] = useState("");
  const [busyAdd, setBusyAdd] = useState(false);
  const [busyUpload, setBusyUpload] = useState(false);

  const authHeaders = { Authorization: `Bearer ${testSecret}`, "Content-Type": "application/json" } as const;

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const url = statusFilter === "all"
        ? `/api/admin/curated?test=${encodeURIComponent(testSecret)}`
        : `/api/admin/curated?test=${encodeURIComponent(testSecret)}&status=${statusFilter}`;
      const res = await fetch(url, { headers: authHeaders });
      const data = (await res.json()) as { grouped?: Grouped; error?: string };
      if (!res.ok || data.error) setErr(data.error ?? `HTTP ${res.status}`);
      else setItems(data.grouped ?? { car: [], drink: [], book: [], product: [] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, testSecret]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(async () => {
    const title = addTitle.trim();
    if (!title) return;
    setBusyAdd(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/curated?test=${encodeURIComponent(testSecret)}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: tab,
          title,
          ...(addNotes.trim() ? { notes: addNotes.trim() } : {}),
          ...(addRefUrl.trim() ? { reference_url: addRefUrl.trim() } : {}),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) setErr(data.error ?? `HTTP ${res.status}`);
      else {
        setAddTitle(""); setAddNotes(""); setAddRefUrl("");
        await refresh();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAdd(false);
    }
  }, [addTitle, addNotes, addRefUrl, tab, testSecret, refresh]);

  const patchStatus = useCallback(async (id: string, status: "active" | "used" | "archived") => {
    setErr(null);
    try {
      const res = await fetch(`/api/admin/curated?test=${encodeURIComponent(testSecret)}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ id, status }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) setErr(data.error ?? `HTTP ${res.status}`);
      else await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [testSecret, refresh]);

  const uploadFile = useCallback(async (file: File) => {
    setBusyUpload(true);
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", tab);
      if (addTitle.trim()) form.append("title", addTitle.trim());
      const res = await fetch(`/api/admin/curated-upload?test=${encodeURIComponent(testSecret)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${testSecret}` },
        body: form,
      });
      const data = (await res.json()) as { publicUrl?: string; error?: string };
      if (!res.ok || data.error || !data.publicUrl) {
        setErr(data.error ?? `HTTP ${res.status}`);
      } else {
        setAddRefUrl(data.publicUrl);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyUpload(false);
    }
  }, [tab, testSecret, addTitle]);

  const uploadForExisting = useCallback(async (id: string, file: File, currentTitle: string) => {
    setErr(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", tab);
      form.append("title", currentTitle);
      const upRes = await fetch(`/api/admin/curated-upload?test=${encodeURIComponent(testSecret)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${testSecret}` },
        body: form,
      });
      const upData = (await upRes.json()) as { publicUrl?: string; error?: string };
      if (!upRes.ok || upData.error || !upData.publicUrl) {
        setErr(upData.error ?? `HTTP ${upRes.status}`);
        return;
      }
      const patchRes = await fetch(`/api/admin/curated?test=${encodeURIComponent(testSecret)}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ id, reference_url: upData.publicUrl }),
      });
      const patchData = (await patchRes.json()) as { error?: string };
      if (!patchRes.ok || patchData.error) setErr(patchData.error ?? `HTTP ${patchRes.status}`);
      else await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [tab, testSecret, refresh]);

  const hardDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this curated item permanently? (Use Archive if you want to keep it in history.)")) return;
    try {
      const res = await fetch(`/api/admin/curated?test=${encodeURIComponent(testSecret)}&id=${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok || data.error) setErr(data.error ?? `HTTP ${res.status}`);
      else await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [testSecret, refresh]);

  const current = items[tab] ?? [];

  return (
    <div>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #d5d8de", marginBottom: 16, flexWrap: "wrap" }}>
        {KINDS.map((k) => {
          const active = tab === k.id;
          const count = items[k.id]?.length ?? 0;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setTab(k.id)}
              style={{
                padding: "10px 16px", border: "none", borderBottom: active ? "2px solid #0a5fb8" : "2px solid transparent",
                background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: active ? 600 : 500,
                color: active ? "#0a5fb8" : "#333",
              }}
            >
              {k.label} <span style={{ color: "#888", fontSize: 12 }}>({count})</span>
            </button>
          );
        })}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, color: "#666" }}>filter:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            style={{ padding: "4px 8px", fontSize: 13, border: "1px solid #d5d8de", borderRadius: 4 }}
          >
            <option value="active">active</option>
            <option value="used">used</option>
            <option value="archived">archived</option>
            <option value="all">all</option>
          </select>
        </div>
      </div>

      <div style={{ background: "#f8f8fa", padding: 12, borderRadius: 6, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#333", marginBottom: 8 }}>
          Add a {KINDS.find((k) => k.id === tab)?.label.slice(0, -1)}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder={KINDS.find((k) => k.id === tab)?.placeholder}
            style={{ flex: "2 1 240px", minWidth: 200, padding: "8px 10px", border: "1px solid #d5d8de", borderRadius: 4, fontSize: 13 }}
            onKeyDown={(e) => { if (e.key === "Enter" && !busyAdd && addTitle.trim()) void add(); }}
          />
          <input
            type="text"
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
            placeholder="optional notes"
            style={{ flex: "1 1 140px", minWidth: 120, padding: "8px 10px", border: "1px solid #d5d8de", borderRadius: 4, fontSize: 13 }}
          />
          <input
            type="text"
            value={addRefUrl}
            onChange={(e) => setAddRefUrl(e.target.value)}
            placeholder="optional ref image URL (or upload →)"
            style={{ flex: "1 1 180px", minWidth: 140, padding: "8px 10px", border: "1px solid #d5d8de", borderRadius: 4, fontSize: 13 }}
          />
          <label
            style={{
              padding: "8px 12px", border: "1px solid #d5d8de", borderRadius: 4, background: busyUpload ? "#f0f0f2" : "#fff",
              cursor: busyUpload ? "wait" : "pointer", fontSize: 13, fontWeight: 500, color: "#333", display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {busyUpload ? "uploading…" : "📁 Upload"}
            <input
              type="file"
              accept="image/*"
              disabled={busyUpload}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadFile(f);
                e.target.value = "";
              }}
              style={{ display: "none" }}
            />
          </label>
          <button
            type="button"
            onClick={add}
            disabled={busyAdd || !addTitle.trim()}
            style={{
              padding: "8px 16px", border: "1px solid #0a5fb8", borderRadius: 4, background: busyAdd ? "#f0f0f2" : "#0a5fb8",
              color: busyAdd ? "#666" : "#fff", cursor: busyAdd || !addTitle.trim() ? "default" : "pointer", fontSize: 13, fontWeight: 600,
            }}
          >
            {busyAdd ? "…" : "Add"}
          </button>
        </div>
        {addRefUrl ? (
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={addRefUrl} alt="ref preview" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, border: "1px solid #d5d8de" }} />
            <span style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addRefUrl}</span>
            <button type="button" onClick={() => setAddRefUrl("")} style={{ padding: "2px 8px", border: "1px solid #c22", background: "#fff", color: "#c22", cursor: "pointer", borderRadius: 3, fontSize: 11 }}>clear</button>
          </div>
        ) : null}
      </div>

      {err ? <div style={{ color: "#c22", fontSize: 13, marginBottom: 12 }}>err: {err}</div> : null}
      {loading ? <div style={{ color: "#888", fontSize: 13 }}>loading…</div> : null}

      {current.length === 0 && !loading ? (
        <div style={{ color: "#888", fontSize: 13, padding: 16 }}>
          No {statusFilter === "all" ? "" : statusFilter + " "}items for {tab}. Add one above.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #d5d8de", textAlign: "left" }}>
              <th style={cellStyle}>Title</th>
              <th style={cellStyle}>Notes</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}>Used in</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {current.map((it) => (
              <tr key={it.id} style={{ borderBottom: "1px solid #eef" }}>
                <td style={cellStyle}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    {it.reference_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <a href={it.reference_url} target="_blank" rel="noopener noreferrer">
                        <img src={it.reference_url} alt="ref" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 4, border: "1px solid #d5d8de", display: "block" }} />
                      </a>
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: 4, border: "1px dashed #d5d8de", background: "#f8f8fa" }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 500 }}>{it.title}</div>
                      <label style={{ fontSize: 10, color: "#0a5fb8", cursor: "pointer" }}>
                        {it.reference_url ? "swap image" : "upload image"}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void uploadForExisting(it.id, f, it.title);
                            e.target.value = "";
                          }}
                          style={{ display: "none" }}
                        />
                      </label>
                    </div>
                  </div>
                </td>
                <td style={{ ...cellStyle, color: "#666" }}>{it.notes || "—"}</td>
                <td style={cellStyle}>
                  <span style={pillStyle(it.status)}>{it.status}</span>
                </td>
                <td style={{ ...cellStyle, color: "#666" }}>{it.used_in_issue_date || "—"}</td>
                <td style={cellStyle}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {it.status !== "active" ? (
                      <button type="button" onClick={() => patchStatus(it.id, "active")} style={miniBtn("#0a7f3f")}>reactivate</button>
                    ) : null}
                    {it.status !== "used" ? (
                      <button type="button" onClick={() => patchStatus(it.id, "used")} style={miniBtn("#b8651a")}>mark used</button>
                    ) : null}
                    {it.status !== "archived" ? (
                      <button type="button" onClick={() => patchStatus(it.id, "archived")} style={miniBtn("#666")}>archive</button>
                    ) : null}
                    <button type="button" onClick={() => hardDelete(it.id)} style={miniBtn("#c22")}>delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cellStyle: React.CSSProperties = { padding: "8px 6px", verticalAlign: "top" };
const miniBtn = (color: string): React.CSSProperties => ({
  padding: "3px 8px", border: `1px solid ${color}`, borderRadius: 3, background: "#fff",
  color, cursor: "pointer", fontSize: 11, fontWeight: 500,
});
function pillStyle(status: string): React.CSSProperties {
  const base: React.CSSProperties = { padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600, display: "inline-block" };
  if (status === "active") return { ...base, color: "#0a7f3f", backgroundColor: "#e6f5ec" };
  if (status === "used") return { ...base, color: "#b8651a", backgroundColor: "#fdf1e5" };
  return { ...base, color: "#666", backgroundColor: "#f0f0f2" };
}
