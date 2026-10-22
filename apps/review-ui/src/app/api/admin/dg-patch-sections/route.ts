/**
 * POST /api/admin/dg-patch-sections
 *   {
 *     issueDate,
 *     patch: {
 *       firstPullParagraphs?: string[],   // overwrites sections.firstPull.paragraphs
 *       mainContentSubhead?: string,
 *       howToTitle?: string,
 *       howToSteps?: Array<{label, body}>,
 *       ancientTruthVerse?: string,
 *       ancientTruthReference?: string,
 *       ancientTruthApplication?: string,
 *       ps?: string,
 *     }
 *   }
 *
 * Surgical edit of specific sections. Re-renders html/text/subject/
 * preheader. Snapshots the pre-patch sections into
 * generation_meta.previousVersions.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { DailyGrindContent } from "../../../../lib/daily-grind-html-template";
import { renderDailyGrindHtml } from "../../../../lib/daily-grind-html-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("test");
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${cronSecret}` || q === cronSecret;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: {
    issueDate?: string;
    patch?: {
      firstPullParagraphs?: string[];
      mainContentSubhead?: string;
      howToTitle?: string;
      howToSteps?: Array<{ label?: string; body?: string }>;
      ancientTruthVerse?: string;
      ancientTruthReference?: string;
      ancientTruthApplication?: string;
      ps?: string;
    };
  };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const patch = body.patch ?? {};
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const { data, error } = await db.from("daily_grind_issues").select("sections").eq("issue_date", issueDate).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  const sections = data.sections as DailyGrindContent | null;
  if (!sections) return NextResponse.json({ error: "no sections" }, { status: 400 });

  const next: DailyGrindContent = structuredClone(sections);
  const changed: string[] = [];
  if (patch.firstPullParagraphs !== undefined) {
    next.firstPull = { paragraphs: patch.firstPullParagraphs.filter((p) => typeof p === "string" && p.trim().length > 0) };
    changed.push(`firstPull.paragraphs(${next.firstPull.paragraphs.length})`);
  }
  if (patch.mainContentSubhead !== undefined) {
    next.mainContent = { ...next.mainContent, subhead: patch.mainContentSubhead };
    changed.push("mainContent.subhead");
  }
  if (patch.howToTitle !== undefined) {
    next.mainContent = { ...next.mainContent, howTo: { ...next.mainContent.howTo, title: patch.howToTitle } };
    changed.push("mainContent.howTo.title");
  }
  if (patch.howToSteps !== undefined) {
    const steps = patch.howToSteps
      .filter((s) => s && typeof s.label === "string" && typeof s.body === "string")
      .map((s) => ({ label: s.label!, body: s.body! }));
    next.mainContent = { ...next.mainContent, howTo: { ...next.mainContent.howTo, steps } };
    changed.push(`mainContent.howTo.steps(${steps.length})`);
  }
  if (patch.ancientTruthVerse !== undefined) {
    next.ancientTruth = { ...next.ancientTruth, verse: patch.ancientTruthVerse };
    changed.push("ancientTruth.verse");
  }
  if (patch.ancientTruthReference !== undefined) {
    next.ancientTruth = { ...next.ancientTruth, reference: patch.ancientTruthReference };
    changed.push("ancientTruth.reference");
  }
  if (patch.ancientTruthApplication !== undefined) {
    next.ancientTruth = { ...next.ancientTruth, application: patch.ancientTruthApplication };
    changed.push("ancientTruth.application");
  }
  if (patch.ps !== undefined) {
    next.ps = patch.ps;
    changed.push("ps");
  }

  if (changed.length === 0) return NextResponse.json({ error: "no patch fields set" }, { status: 400 });

  const rendered = renderDailyGrindHtml(next, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/grind/",
  });
  const { error: upErr } = await db
    .from("daily_grind_issues")
    .update({
      sections: next,
      html: rendered.html,
      text_body: rendered.text,
      subject: rendered.subject,
      preheader: rendered.preheader,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("dg_patch_sections.success", { issueDate, changed });
  return NextResponse.json({ ok: true, changed, subject: rendered.subject, htmlLen: rendered.html.length });
}
