/**
 * POST /api/admin/latte-set-tasting-url
 *   { issueDate, index, url }
 *
 * Sets or clears the url on a tasting menu item without touching
 * title/body. Pass url="" or null to clear.
 *
 * Also handles the Drive URL: pass slot="theDrive" instead of index.
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
  let body: { issueDate?: string; index?: number; slot?: string; url?: string | null };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const newUrl = typeof body.url === "string" ? body.url.trim() : "";
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("sections")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  const sections = data.sections as SaturdayLatteContent | null;
  if (!sections) return NextResponse.json({ error: "no sections" }, { status: 400 });

  const next: SaturdayLatteContent = structuredClone(sections);
  let changed = "";
  let prev: string | undefined;
  if (body.slot === "theDrive") {
    prev = next.theDrive.url;
    if (newUrl) next.theDrive.url = newUrl;
    else delete (next.theDrive as { url?: string }).url;
    changed = "theDrive.url";
  } else {
    const idx = Number(body.index ?? -1);
    if (!Number.isInteger(idx) || idx < 0 || idx > 2) return NextResponse.json({ error: "index must be 0, 1, or 2 (unless slot=theDrive)" }, { status: 400 });
    const item = next.tastingMenu[idx];
    if (!item) return NextResponse.json({ error: `no tastingMenu[${idx}]` }, { status: 400 });
    prev = item.url;
    if (newUrl) item.url = newUrl;
    else delete (item as { url?: string }).url;
    changed = `tastingMenu[${idx}].url`;
  }

  const rendered = renderSaturdayLatteHtml(next, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });
  const { error: upErr } = await db
    .from("saturday_latte_issues")
    .update({ sections: next, html: rendered.html, text_body: rendered.text, subject: rendered.subject, preheader: rendered.preheader })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("latte_set_tasting_url.success", { issueDate, changed, prevUrl: prev, newUrl: newUrl || null });
  return NextResponse.json({ ok: true, changed, prev, next: newUrl || null });
}
