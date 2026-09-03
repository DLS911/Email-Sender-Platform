"use client";

import { useState, useCallback } from "react";

type SlotKey =
  | "hero"
  | "cover-detail"
  | "hosts-corner"
  | "the-drive"
  | "tasting-1"
  | "tasting-2"
  | "tasting-3";

export function SlotControls(props: {
  issueDate: string;
  testSecret: string;
  slot: SlotKey;
  label: string;
  imageUrl: string | null;
  subject: string;
  regenCount: number;
  referenceUrl: string | null;
}) {
  const { issueDate, testSecret, slot, label, subject, regenCount, referenceUrl } = props;
  const [imageUrl, setImageUrl] = useState<string | null>(props.imageUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regens, setRegens] = useState(regenCount);
  const [showFull, setShowFull] = useState<"gen" | "ref" | null>(null);

  const regenerate = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/regenerate-slot?test=${encodeURIComponent(testSecret)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${testSecret}` },
        body: JSON.stringify({ issueDate, slot }),
      });
      const data = (await res.json()) as { newUrl?: string; error?: string; regenerationCount?: number };
      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else if (data.newUrl) {
        setImageUrl(`${data.newUrl}?t=${Date.now()}`);
        if (typeof data.regenerationCount === "number") setRegens(data.regenerationCount);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, issueDate, slot, testSecret]);

  return (
    <div style={cardStyle}>
      <div style={{ position: "relative", background: "#f6f6f8", borderRadius: 4, overflow: "hidden", aspectRatio: "1 / 1" }}>
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={label}
            onClick={() => setShowFull("gen")}
            style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in", display: "block" }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#aaa", fontSize: 12 }}>no image</div>
        )}
        {busy ? (
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#333" }}>
            Regenerating…
          </div>
        ) : null}
      </div>
      <div style={{ padding: "8px 4px 0 4px" }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: "#222" }}>{label}</div>
        <div style={{ fontSize: 11, color: "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>{subject || "—"}</div>
        {regens > 0 ? <div style={{ fontSize: 10, color: "#b8651a", marginTop: 2 }}>regenerated {regens}×</div> : null}
        {referenceUrl ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, padding: "4px 6px", background: "#f6f6f8", borderRadius: 4 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={referenceUrl}
              alt={`ref: ${label}`}
              onClick={() => setShowFull("ref")}
              style={{ width: 28, height: 28, objectFit: "cover", borderRadius: 3, border: "1px solid #d5d8de", cursor: "zoom-in", flexShrink: 0 }}
            />
            <a
              href={referenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 10, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textDecoration: "none" }}
              title={referenceUrl}
            >
              ref image ↗
            </a>
          </div>
        ) : (
          <div style={{ fontSize: 10, color: "#aaa", marginTop: 6 }}>no reference (text-only)</div>
        )}
        {error ? <div style={{ fontSize: 10, color: "#c22", marginTop: 4 }}>err: {error}</div> : null}
        <button
          type="button"
          onClick={regenerate}
          disabled={busy}
          style={{
            marginTop: 8, width: "100%", padding: "6px 10px", border: "1px solid #d5d8de", borderRadius: 4,
            background: busy ? "#f0f0f2" : "#fff", cursor: busy ? "wait" : "pointer", fontSize: 12, fontWeight: 500,
          }}
        >
          {busy ? "…" : "Regenerate"}
        </button>
      </div>
      {showFull ? (
        // Lightbox — shows either the generated image or the reference
        <div
          onClick={() => setShowFull(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out", padding: 24, flexDirection: "column", gap: 12,
          }}
        >
          <div style={{ color: "#fff", fontSize: 12, opacity: 0.75 }}>{showFull === "gen" ? "generated" : "reference"}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={showFull === "gen" ? imageUrl ?? "" : referenceUrl ?? ""}
            alt={label}
            style={{ maxWidth: "100%", maxHeight: "80vh", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ApprovalActions(props: {
  approvalStatus: string;
  approveUrl: string;
  needsWorkUrl: string;
}) {
  const { approvalStatus, approveUrl, needsWorkUrl } = props;
  const [busyAction, setBusyAction] = useState<"approve" | "needs_work" | null>(null);
  const [status, setStatus] = useState(approvalStatus);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(async (action: "approve" | "needs_work") => {
    if (busyAction) return;
    setError(null);
    setBusyAction(action);
    try {
      const url = action === "approve" ? approveUrl : needsWorkUrl;
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        const body = await res.text();
        setError(body.slice(0, 200));
      } else {
        setStatus(action === "approve" ? "approved" : "needs_work");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyAction(null);
    }
  }, [approveUrl, needsWorkUrl, busyAction]);

  const statusStyle: React.CSSProperties = {
    padding: "4px 12px", borderRadius: 4, fontSize: 12, fontWeight: 600,
    ...(status === "approved" ? { color: "#0a7f3f", backgroundColor: "#e6f5ec" }
      : status === "needs_work" ? { color: "#b8651a", backgroundColor: "#fdf1e5" }
      : { color: "#666", backgroundColor: "#f0f0f2" }),
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={statusStyle}>{status}</span>
      <button
        type="button"
        onClick={() => act("approve")}
        disabled={busyAction !== null || status === "approved"}
        style={{
          padding: "6px 14px", border: "1px solid #0a7f3f", borderRadius: 4, background: status === "approved" ? "#e6f5ec" : "#fff",
          color: "#0a7f3f", cursor: busyAction || status === "approved" ? "default" : "pointer", fontSize: 13, fontWeight: 600,
        }}
      >
        {busyAction === "approve" ? "…" : "Approve"}
      </button>
      <button
        type="button"
        onClick={() => act("needs_work")}
        disabled={busyAction !== null || status === "needs_work"}
        style={{
          padding: "6px 14px", border: "1px solid #b8651a", borderRadius: 4, background: status === "needs_work" ? "#fdf1e5" : "#fff",
          color: "#b8651a", cursor: busyAction || status === "needs_work" ? "default" : "pointer", fontSize: 13, fontWeight: 600,
        }}
      >
        {busyAction === "needs_work" ? "…" : "Needs work"}
      </button>
      {error ? <div style={{ fontSize: 11, color: "#c22", width: "100%" }}>err: {error}</div> : null}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #e5e7ea",
  borderRadius: 6,
  padding: 8,
  background: "#fff",
  display: "flex",
  flexDirection: "column",
};
