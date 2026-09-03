/**
 * Latte per-issue review page.
 *
 * Layout (mobile-friendly, single column):
 *   1. Header: date + headline + approval status + Approve / Needs Work buttons.
 *   2. Slot grid: hero, coverDetail, hostsCorner, theDrive, tasting-1/2/3.
 *      Each slot = thumbnail (click for full size) + subject label + regen count
 *      + [Regenerate] button.
 *   3. Rendered issue preview in an iframe.
 *   4. Regen history log (collapsible).
 *
 *   /admin/latte/<YYYY-MM-DD>?test=<CRON_SECRET>
 */

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { approvalUrl } from "../../../../lib/approval-token";
import { SlotControls, ApprovalActions } from "./SlotControls";

export const dynamic = "force-dynamic";

function isAuthorized(test: string | undefined): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return test === cronSecret;
}

type IssueRow = {
  issue_date: string;
  cover_story_headline: string;
  subject: string | null;
  html: string | null;
  approval_status: string | null;
  approval_notes: string | null;
  sections: unknown;
};

type SlotDef = {
  key: "hero" | "cover-detail" | "hosts-corner" | "the-drive" | "tasting-1" | "tasting-2" | "tasting-3";
  label: string;
  imagesKey: "hero" | "coverDetail" | "hostsCorner" | "theDrive" | ["tastingMenu", 0 | 1 | 2];
  subjectPath: string;
};

const SLOTS: SlotDef[] = [
  { key: "hero", label: "Hero", imagesKey: "hero", subjectPath: "coverStoryHeadline" },
  { key: "cover-detail", label: "Cover Detail", imagesKey: "coverDetail", subjectPath: "coverStoryHeadline" },
  { key: "hosts-corner", label: "Host's Corner", imagesKey: "hostsCorner", subjectPath: "hostsCorner.moveTitle" },
  { key: "the-drive", label: "The Drive", imagesKey: "theDrive", subjectPath: "theDrive.car" },
  { key: "tasting-1", label: "Tasting #1", imagesKey: ["tastingMenu", 0], subjectPath: "tastingMenu.0.title" },
  { key: "tasting-2", label: "Tasting #2", imagesKey: ["tastingMenu", 1], subjectPath: "tastingMenu.1.title" },
  { key: "tasting-3", label: "Tasting #3", imagesKey: ["tastingMenu", 2], subjectPath: "tastingMenu.2.title" },
];

function extractByPath(obj: Record<string, unknown>, path: string): string {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null) return "";
    if (Array.isArray(cur)) {
      const idx = parseInt(p, 10);
      cur = cur[idx];
    } else if (typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    }
  }
  return typeof cur === "string" ? cur : "";
}

function imageUrlFor(images: Record<string, unknown>, key: SlotDef["imagesKey"]): string | null {
  if (Array.isArray(key)) {
    const [outer, idx] = key;
    const arr = images[outer];
    if (Array.isArray(arr)) return typeof arr[idx] === "string" ? (arr[idx] as string) : null;
    return null;
  }
  const v = images[key];
  return typeof v === "string" ? v : null;
}

export default async function LatteReviewDetail({
  params,
  searchParams,
}: {
  params: Promise<{ issueDate: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { issueDate } = await params;
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
    .select("issue_date, cover_story_headline, subject, html, approval_status, approval_notes, sections")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) {
    return (
      <main style={pageStyle}>
        <h1>Latte review — {issueDate}</h1>
        <p>Error: {error.message}</p>
        <Link href={`/admin/latte?test=${testParam}`} style={backLinkStyle}>← back to index</Link>
      </main>
    );
  }
  const row = data as IssueRow | null;
  if (!row) {
    return (
      <main style={pageStyle}>
        <h1>Latte review — {issueDate}</h1>
        <p>No issue found for {issueDate}.</p>
        <Link href={`/admin/latte?test=${testParam}`} style={backLinkStyle}>← back to index</Link>
      </main>
    );
  }

  const sections = (row.sections ?? {}) as Record<string, unknown>;
  const images = (sections.images ?? {}) as Record<string, unknown>;
  const regenHistory = Array.isArray(sections.slotRegenerations) ? (sections.slotRegenerations as Array<Record<string, unknown>>) : [];
  const regenCountBySlot = regenHistory.reduce<Record<string, number>>((acc, e) => {
    const s = typeof e.slot === "string" ? e.slot : "?";
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const baseUrl = process.env.PUBLIC_BASE_URL || "https://email-sndr-platform.vercel.app";
  const approveUrl = approvalUrl(baseUrl, "latte", issueDate, "approve");
  const needsWorkUrl = approvalUrl(baseUrl, "latte", issueDate, "needs-work");

  return (
    <main style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <Link href={`/admin/latte?test=${testParam}`} style={backLinkStyle}>← index</Link>
          <h1 style={{ margin: "8px 0 4px 0" }}>{row.cover_story_headline}</h1>
          <p style={{ color: "#666", fontSize: 14, margin: 0 }}>{row.issue_date} · {row.subject}</p>
        </div>
        <ApprovalActions
          approvalStatus={row.approval_status ?? "pending"}
          approveUrl={approveUrl}
          needsWorkUrl={needsWorkUrl}
        />
      </div>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12, color: "#333" }}>Images (per-slot regenerate)</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {SLOTS.map((slot) => {
            const url = imageUrlFor(images, slot.imagesKey);
            const subject = extractByPath(sections, slot.subjectPath);
            const regens = regenCountBySlot[slot.key] ?? 0;
            return (
              <SlotControls
                key={slot.key}
                issueDate={issueDate}
                testSecret={testParam ?? ""}
                slot={slot.key}
                label={slot.label}
                imageUrl={url}
                subject={subject}
                regenCount={regens}
              />
            );
          })}
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12, color: "#333" }}>Rendered preview</h2>
        {row.html ? (
          <iframe
            srcDoc={row.html}
            style={{ width: "100%", height: 900, border: "1px solid #d5d8de", borderRadius: 6, background: "#fff" }}
            title={`preview-${issueDate}`}
          />
        ) : (
          <p>No rendered HTML for this issue.</p>
        )}
      </section>

      {regenHistory.length > 0 ? (
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 16, marginBottom: 12, color: "#333" }}>Regen history</h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #d5d8de", textAlign: "left" }}>
                <th style={cellStyle}>When</th>
                <th style={cellStyle}>Slot</th>
                <th style={cellStyle}>Prev</th>
                <th style={cellStyle}>New</th>
                <th style={cellStyle}>Latency</th>
              </tr>
            </thead>
            <tbody>
              {[...regenHistory].reverse().map((e, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eef" }}>
                  <td style={cellStyle}>{typeof e.at === "string" ? e.at.replace("T", " ").slice(0, 19) : "—"}</td>
                  <td style={cellStyle}>{typeof e.slot === "string" ? e.slot : "—"}</td>
                  <td style={cellStyle}>{typeof e.prevUrl === "string" ? <a href={e.prevUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#0a5fb8" }}>prev</a> : "—"}</td>
                  <td style={cellStyle}>{typeof e.newUrl === "string" ? <a href={e.newUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#0a5fb8" }}>new</a> : "—"}</td>
                  <td style={cellStyle}>{typeof e.latencyMs === "number" ? `${e.latencyMs}ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  maxWidth: 1100,
  margin: "0 auto",
};
const cellStyle: React.CSSProperties = { padding: "6px 8px" };
const backLinkStyle: React.CSSProperties = { color: "#0a5fb8", fontSize: 13, textDecoration: "none" };
