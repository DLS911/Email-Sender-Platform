/**
 * POST /api/admin/latte-copy-drive
 *   { targetDate, sourceDate, overrideUrl?: string }
 *
 * Copies the entire theDrive sub-object (car, specs, body, url, imageUrl)
 * from sourceDate's Latte issue into targetDate's. Optionally overrides
 * the url with overrideUrl. Re-renders target. Used when images are
 * unavailable and we want to reuse a prior Latte's Drive (image + copy
 * stay in sync — can't mismatch).
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";

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
  let body: { targetDate?: string; sourceDate?: string; overrideUrl?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const targetDate = body.targetDate?.trim();
  const sourceDate = body.sourceDate?.trim();
  if (!targetDate || !sourceDate) return NextResponse.json({ error: "targetDate + sourceDate required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const [sourceRes, targetRes] = await Promise.all([
    db.from("saturday_latte_issues").select("sections").eq("issue_date", sourceDate).maybeSingle(),
    db.from("saturday_latte_issues").select("sections").eq("issue_date", targetDate).maybeSingle(),
  ]);
  if (sourceRes.error) return NextResponse.json({ error: `source: ${sourceRes.error.message}` }, { status: 500 });
  if (targetRes.error) return NextResponse.json({ error: `target: ${targetRes.error.message}` }, { status: 500 });
  if (!sourceRes.data) return NextResponse.json({ error: `no source issue for ${sourceDate}` }, { status: 404 });
  if (!targetRes.data) return NextResponse.json({ error: `no target issue for ${targetDate}` }, { status: 404 });

  const sourceSections = sourceRes.data.sections as (SaturdayLatteContent & { images?: Record<string, unknown> }) | null;
  const targetSections = targetRes.data.sections as (SaturdayLatteContent & { images?: Record<string, unknown> }) | null;
  if (!sourceSections || !targetSections) return NextResponse.json({ error: "sections missing" }, { status: 400 });
  const srcDrive = sourceSections.theDrive;
  const srcImage = (sourceSections.images as { theDrive?: string } | undefined)?.theDrive;
  if (!srcDrive) return NextResponse.json({ error: `source has no theDrive` }, { status: 400 });

  const next: SaturdayLatteContent & { images?: Record<string, unknown> } = structuredClone(targetSections);
  const prevDrive = next.theDrive;
  const prevImage = (next.images as { theDrive?: string } | undefined)?.theDrive;
  // Replace Drive. Preserve any extra fields the type doesn't model.
  next.theDrive = { ...srcDrive };
  if (body.overrideUrl !== undefined) {
    if (body.overrideUrl) next.theDrive.url = body.overrideUrl;
    else delete (next.theDrive as { url?: string }).url;
  }
  // Also copy the image reference so the car + photo stay in sync.
  if (srcImage) {
    next.images = { ...(next.images ?? {}), theDrive: srcImage };
  } else {
    if (next.images) delete (next.images as { theDrive?: string }).theDrive;
  }

  const rendered = renderSaturdayLatteHtml(next, {
    issueDate: targetDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });
  const { error: upErr } = await db
    .from("saturday_latte_issues")
    .update({ sections: next, html: rendered.html, text_body: rendered.text, subject: rendered.subject, preheader: rendered.preheader })
    .eq("issue_date", targetDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("latte_copy_drive.success", {
    sourceDate, targetDate,
    prevCar: prevDrive?.car, newCar: next.theDrive.car,
    prevImage, newImage: srcImage,
  });
  return NextResponse.json({
    ok: true,
    sourceDate, targetDate,
    prev: { car: prevDrive?.car, url: prevDrive?.url, imageUrl: prevImage },
    next: { car: next.theDrive.car, url: next.theDrive.url, imageUrl: srcImage },
  });
}
