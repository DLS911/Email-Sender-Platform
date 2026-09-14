"use client";

import { useCallback, useState } from "react";

type Props = {
  issueDate: string;
  testSecret: string;
  approvalStatus: string;
};

/**
 * "Push to ActiveCampaign" button. Only enabled once the issue is
 * approved (Latte requires this per the endpoint; DG can push
 * regardless). On click, POSTs to /api/admin/push-to-activecampaign
 * with brand=latte + issueDate (as a draft — you review the campaign
 * in AC and click Send there). Shows the returned AC dashboard URL.
 */
export function PushToActiveCampaign({ issueDate, testSecret, approvalStatus }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ campaignId: string; dashboardUrl: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canPush = approvalStatus === "approved";

  const push = useCallback(async () => {
    if (busy || !canPush) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/push-to-activecampaign?test=${encodeURIComponent(testSecret)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${testSecret}` },
        body: JSON.stringify({ brand: "latte", issueDate, asDraft: true }),
      });
      const data = (await res.json()) as { campaignId?: string; dashboardUrl?: string; status?: string; error?: string };
      if (!res.ok || data.error || !data.campaignId) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setResult({ campaignId: data.campaignId, dashboardUrl: data.dashboardUrl ?? "", status: data.status ?? "draft" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, canPush, issueDate, testSecret]);

  if (result) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          padding: "4px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600, color: "#0a7f3f", backgroundColor: "#e6f5ec",
        }}>
          ✓ Pushed to AC ({result.status})
        </span>
        {result.dashboardUrl ? (
          <a href={result.dashboardUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#0a5fb8", fontSize: 12, textDecoration: "underline" }}>
            open in AC →
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={push}
        disabled={busy || !canPush}
        title={!canPush ? "Approve the issue first before pushing to AC" : "Push this issue to ActiveCampaign as a draft campaign — you review + hit Send inside AC"}
        style={{
          padding: "6px 14px", border: "1px solid #7a4a1a", borderRadius: 4,
          background: busy ? "#f0f0f2" : canPush ? "#7a4a1a" : "#fff",
          color: busy ? "#666" : canPush ? "#fff" : "#7a4a1a",
          cursor: busy || !canPush ? "default" : "pointer",
          fontSize: 13, fontWeight: 600, opacity: canPush ? 1 : 0.5,
        }}
      >
        {busy ? "…" : "🚀 Push to AC"}
      </button>
      {error ? <span style={{ fontSize: 11, color: "#c22" }}>err: {error}</span> : null}
    </div>
  );
}
