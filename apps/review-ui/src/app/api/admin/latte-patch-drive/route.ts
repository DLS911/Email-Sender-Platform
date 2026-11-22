/**
 * POST /api/admin/latte-patch-drive
 *   { issueDate, car?: string, specs?: string, body?: string, url?: string }
 *
 * Surgical edit of the Latte "The Drive" text fields. Re-renders with the
 * v1 renderer and snapshots previousVersions like the other latte-* routes.
 *
 * Built 2026-11-22 after the 11-21 issue shipped with the IMAGE PROMPT in
 * theDrive.body ("...Pop-up headlights retracted (NOT the fixed headlights
 * of the FC generation)... Portra 400 warmth. No people in frame."). The
 * writer had put the visual spec in the reader-facing field; nothing in
 * the pipeline checked the field's shape, and there was no route to fix
 * the text without a regen.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";
import { mergePreviousVersion } from "../../../../lib/issue-history";

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

function cleanString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { issueDate?: string; car?: string; specs?: string; body?: string; url?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  const patch = { car: cleanString(body.car), specs: cleanString(body.specs), body: cleanString(body.body), url: cleanString(body.url) };
  if (!patch.car && !patch.specs && !patch.body && !patch.url) {
    return NextResponse.json({ error: "nothing to patch: pass car, specs, body, and/or url" }, { status: 400 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data, error } = await db.from("saturday_latte_issues").select("sections").eq("issue_date", issueDate).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  const sections = data.sections as SaturdayLatteContent | null;
  if (!sections || !sections.theDrive) return NextResponse.json({ error: "row has no theDrive section" }, { status: 400 });

  const next: SaturdayLatteContent = structuredClone(sections);
  const prev = { ...next.theDrive };
  const changed: string[] = [];
  if (patch.car) { next.theDrive.car = patch.car; changed.push("car"); }
  if (patch.specs) { next.theDrive.specs = patch.specs; changed.push("specs"); }
  if (patch.body) { next.theDrive.body = patch.body; changed.push("body"); }
  if (patch.url) { next.theDrive.url = patch.url; changed.push("url"); }

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

  logger.info("latte_patch_drive.success", { issueDate, changed });
  return NextResponse.json({ ok: true, changed, prev: { car: prev.car, bodyPreview: (prev.body ?? "").slice(0, 120) }, theDrive: next.theDrive });
}
