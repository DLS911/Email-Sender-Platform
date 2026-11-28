/**
 * POST /api/admin/latte-patch-sponsor
 *   { issueDate, sponsor: { label?, headline, body, ctaLabel?, ctaUrl?, theme? } | null }
 *
 * Sets or clears the optional sponsor block on a Latte issue (pass
 * sponsor: null to remove it). Re-renders with the v1 renderer and
 * snapshots previousVersions like the other latte-* routes.
 *
 * Built 2026-11-28: the Black Friday offer ran in the Daily Grind's
 * per-issue sponsor override on 11-25 and 11-27; Mark wanted the same
 * block in the Saturday issue, and the Latte had no sponsor slot at all.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";
import { mergePreviousVersion } from "../../../../lib/issue-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sponsor = NonNullable<SaturdayLatteContent["sponsor"]>;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("test");
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${cronSecret}` || q === cronSecret;
}

function parseSponsor(v: unknown): Sponsor | null | "invalid" {
  if (v === null) return null;
  if (typeof v !== "object" || v === null) return "invalid";
  const o = v as Record<string, unknown>;
  const headline = typeof o.headline === "string" ? o.headline.trim() : "";
  const body = typeof o.body === "string" ? o.body.trim() : "";
  if (!headline || !body) return "invalid";
  const s: Sponsor = { headline, body };
  if (typeof o.label === "string" && o.label.trim()) s.label = o.label.trim();
  if (typeof o.ctaLabel === "string" && o.ctaLabel.trim()) s.ctaLabel = o.ctaLabel.trim();
  if (typeof o.ctaUrl === "string" && o.ctaUrl.trim()) s.ctaUrl = o.ctaUrl.trim();
  if (o.theme === "dark" || o.theme === "light") s.theme = o.theme;
  return s;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { issueDate?: string; sponsor?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!("sponsor" in body)) return NextResponse.json({ error: "sponsor required (object, or null to clear)" }, { status: 400 });
  const sponsor = parseSponsor(body.sponsor);
  if (sponsor === "invalid") return NextResponse.json({ error: "sponsor needs headline and body (or pass null to clear)" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db.from("saturday_latte_issues").select("sections").eq("issue_date", issueDate).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  const sections = data.sections as SaturdayLatteContent | null;
  if (!sections || !sections.coverStoryHeadline) return NextResponse.json({ error: "row is not a v1 Latte" }, { status: 400 });

  const next: SaturdayLatteContent = structuredClone(sections);
  const had = Boolean(next.sponsor);
  if (sponsor === null) delete next.sponsor; else next.sponsor = sponsor;

  const rendered = renderSaturdayLatteHtml(next, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });
  const mergedMeta = await mergePreviousVersion(db, "saturday_latte_issues", issueDate, null);
  const { error: upErr } = await db
    .from("saturday_latte_issues")
    .update({ sections: next, html: rendered.html, text_body: rendered.text, subject: rendered.subject, preheader: rendered.preheader, generation_meta: mergedMeta })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("latte_patch_sponsor.success", { issueDate, cleared: sponsor === null, had });
  return NextResponse.json({ ok: true, issueDate, sponsor: next.sponsor ?? null, previouslyHadSponsor: had });
}
