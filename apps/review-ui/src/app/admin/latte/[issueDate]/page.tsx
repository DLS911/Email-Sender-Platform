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
import { InlineHistory } from "./InlineHistory";
import { EditableTextBlock } from "./EditableTextBlock";

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

// Convert the regenerate-slot storage key ("the-drive", "tasting-1", …)
// to the imageReferences map key emitted by generateAndStore
// ("the-drive", "tasting-1", …). The two are aligned by convention;
// this helper exists so a future rename doesn't silently drift.
function slotToImageKeyForRef(slot: string): string {
  return slot;
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
  const [issueRes, historyRes] = await Promise.all([
    db.from("saturday_latte_issues")
      .select("issue_date, cover_story_headline, subject, html, approval_status, approval_notes, sections")
      .eq("issue_date", issueDate)
      .maybeSingle(),
    db.from("latte_recommendations")
      .select("id, kind, value, normalized_value, context, issue_date, created_at")
      .eq("brand", "saturday_latte")
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);
  const { data, error } = issueRes;
  const historyRows = (historyRes.data ?? []) as Array<{ id: string; kind: string; value: string; normalized_value: string; context: string | null; issue_date: string; created_at: string }>;
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
  const imageReferences = (sections.imageReferences ?? {}) as Record<string, string | null>;
  const regenHistory = Array.isArray(sections.slotRegenerations) ? (sections.slotRegenerations as Array<Record<string, unknown>>) : [];
  const regenCountBySlot = regenHistory.reduce<Record<string, number>>((acc, e) => {
    const s = typeof e.slot === "string" ? e.slot : "?";
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  // Latest slotRegenerations entry per slot exposes the reference URL used
  // on the most recent regenerate (useful when the initial gen didn't use
  // a ref but a regen did). Overrides the initial imageReferences entry.
  for (const entry of regenHistory) {
    const s = typeof entry.slot === "string" ? entry.slot : null;
    const r = typeof entry.referenceUrl === "string" ? entry.referenceUrl : null;
    if (s && r) imageReferences[slotToImageKeyForRef(s)] = r;
  }

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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ fontSize: 16, margin: 0, color: "#333" }}>Images (per-slot regenerate)</h2>
          <Link
            href={`/admin/latte/history?test=${testParam}`}
            target="_blank"
            style={{ color: "#4a4540", fontSize: 12, textDecoration: "none", padding: "4px 10px", border: "1px solid #d5d8de", borderRadius: 4 }}
            title="Every item ever recommended — check for repeats"
          >
            📜 History
          </Link>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {SLOTS.map((slot) => {
            const url = imageUrlFor(images, slot.imagesKey);
            const subject = extractByPath(sections, slot.subjectPath);
            const regens = regenCountBySlot[slot.key] ?? 0;
            const referenceUrl = imageReferences[slot.key] ?? null;
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
                referenceUrl={referenceUrl}
              />
            );
          })}
        </div>
      </section>

      <section style={{ marginTop: 32, position: "relative" }}>
        <h2 style={{ fontSize: 16, marginBottom: 12, color: "#333" }}>
          Copy — highlight text to flag it
        </h2>
        <p style={{ fontSize: 12, color: "#666", margin: "0 0 12px 0" }}>
          Select any span of text below, click the <span style={{ background: "#0a5fb8", color: "#fff", padding: "1px 6px", borderRadius: 8, fontSize: 10 }}>💬 Flag</span> pill, type what's wrong, and Sonnet rewrites the whole passage in Mark's voice preserving everything else.
        </p>
        <div style={{ background: "#fdfdfe", border: "1px solid #eef", borderRadius: 6, padding: 20 }}>
          {(() => {
            const c = sections as unknown as {
              coverStoryHeadline?: string; preheader?: string; coverStoryParagraphs?: string[];
              tastingMenu?: Array<{ label?: string; title?: string; body?: string }>;
              hostsCorner?: { leadIn?: string; moveTitle?: string; moveBody?: string };
              theDrive?: { car?: string; body?: string };
              sundayPrep?: { title?: string; body?: string };
              sabbath?: { verse?: string; reference?: string; reflection?: string };
              ps?: string;
            };
            const blocks: React.ReactNode[] = [];
            if (c.coverStoryHeadline) {
              blocks.push(
                <div key="hdr" style={{ marginBottom: 20 }}>
                  <div style={mutedLabel}>Cover Story headline</div>
                  <EditableTextBlock as="div" issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="coverStoryHeadline" label="Cover Story headline" initialText={c.coverStoryHeadline} style={{ fontSize: 22, fontWeight: 700, color: "#2d2926", lineHeight: 1.25 }} />
                </div>,
              );
            }
            if (c.preheader) {
              blocks.push(
                <div key="pre" style={{ marginBottom: 20 }}>
                  <div style={mutedLabel}>Preheader</div>
                  <EditableTextBlock as="div" issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="preheader" label="Preheader" initialText={c.preheader} style={{ fontSize: 14, fontStyle: "italic", color: "#666" }} />
                </div>,
              );
            }
            (c.coverStoryParagraphs ?? []).forEach((p, i) => {
              blocks.push(
                <div key={`cp-${i}`} style={{ marginBottom: 14 }}>
                  <div style={mutedLabel}>Cover Story · paragraph {i + 1}</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath={`coverStoryParagraphs.${i}`} label={`Cover Story paragraph ${i + 1}`} initialText={p} style={sectionText} />
                </div>,
              );
            });
            (c.tastingMenu ?? []).forEach((t, i) => {
              if (!t?.body) return;
              blocks.push(
                <div key={`tm-${i}`} style={{ marginBottom: 14 }}>
                  <div style={mutedLabel}>{t.label ?? "Tasting"} · {t.title ?? `#${i + 1}`}</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath={`tastingMenu.${i}.body`} label={`Tasting #${i + 1} body`} initialText={t.body} style={sectionText} />
                </div>,
              );
            });
            if (c.hostsCorner?.leadIn) {
              blocks.push(
                <div key="hc-lead" style={{ marginBottom: 14 }}>
                  <div style={mutedLabel}>Host&apos;s Corner · lead-in</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="hostsCorner.leadIn" label="Host's Corner lead-in" initialText={c.hostsCorner.leadIn} style={sectionText} />
                </div>,
              );
            }
            if (c.hostsCorner?.moveBody) {
              blocks.push(
                <div key="hc-body" style={{ marginBottom: 14 }}>
                  <div style={mutedLabel}>Host&apos;s Corner · {c.hostsCorner.moveTitle ?? "move"} body</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="hostsCorner.moveBody" label="Host's Corner move body" initialText={c.hostsCorner.moveBody} style={sectionText} />
                </div>,
              );
            }
            if (c.theDrive?.body) {
              blocks.push(
                <div key="drive" style={{ marginBottom: 14 }}>
                  <div style={mutedLabel}>The Drive · {c.theDrive.car ?? ""} body</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="theDrive.body" label="The Drive body" initialText={c.theDrive.body} style={sectionText} />
                </div>,
              );
            }
            if (c.sundayPrep?.body) {
              blocks.push(
                <div key="sp" style={{ marginBottom: 14 }}>
                  <div style={mutedLabel}>Sunday Prep · {c.sundayPrep.title ?? ""} body</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="sundayPrep.body" label="Sunday Prep body" initialText={c.sundayPrep.body} style={sectionText} />
                </div>,
              );
            }
            if (c.sabbath?.reflection) {
              blocks.push(
                <div key="sab" style={{ marginBottom: 14 }}>
                  <div style={mutedLabel}>Sabbath · reflection ({c.sabbath.reference ?? ""})</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="sabbath.reflection" label="Sabbath reflection" initialText={c.sabbath.reflection} style={sectionText} />
                </div>,
              );
            }
            if (c.ps) {
              blocks.push(
                <div key="ps" style={{ marginBottom: 4 }}>
                  <div style={mutedLabel}>P.S.</div>
                  <EditableTextBlock issueDate={issueDate} testSecret={testParam ?? ""} fieldPath="ps" label="P.S." initialText={c.ps} style={sectionText} />
                </div>,
              );
            }
            return blocks;
          })()}
        </div>
      </section>

      <InlineHistory rows={historyRows} />

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
                <th style={cellStyle}>Feedback</th>
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
                  <td style={{ ...cellStyle, maxWidth: 320, color: typeof e.criticism === "string" && e.criticism ? "#333" : "#aaa" }}>
                    {typeof e.criticism === "string" && e.criticism ? e.criticism : "—"}
                  </td>
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
const mutedLabel: React.CSSProperties = { fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 };
const sectionText: React.CSSProperties = { fontSize: 15, lineHeight: 1.65, color: "#2d2926", margin: 0 };
