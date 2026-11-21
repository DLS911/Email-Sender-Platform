/**
 * POST /api/admin/latte-set-sabbath-reflection
 *   { issueDate, reflection: "" | "new text" }
 *
 * Sets or clears the sabbath.reflection text. Pass reflection="" to
 * remove the AI-added commentary paragraph beneath the verse. The
 * verse + reference stay as they are.
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
  // 2026-11-21: also accepts optional verse + reference so a repeated verse
  // can be swapped without a regen (Psalm 19 had shipped six times).
  let body: { issueDate?: string; reflection?: string | null; verse?: string; reference?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const nextRefl = typeof body.reflection === "string" ? body.reflection : "";
  const nextVerse = typeof body.verse === "string" && body.verse.trim() ? body.verse.trim() : null;
  const nextReference = typeof body.reference === "string" && body.reference.trim() ? body.reference.trim() : null;
  if ((nextVerse === null) !== (nextReference === null)) {
    return NextResponse.json({ error: "verse and reference must be provided together" }, { status: 400 });
  }
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
  if (!sections.sabbath) return NextResponse.json({ error: "no sabbath section" }, { status: 400 });

  const next: SaturdayLatteContent = structuredClone(sections);
  const prev = next.sabbath.reflection;
  const prevReference = next.sabbath.reference;
  next.sabbath.reflection = nextRefl;
  if (nextVerse !== null && nextReference !== null) {
    next.sabbath.verse = nextVerse;
    next.sabbath.reference = nextReference;
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

  logger.info("latte_set_sabbath_reflection.success", { issueDate, prevLen: prev?.length ?? 0, nextLen: nextRefl.length, prevReference, nextReference: next.sabbath.reference });
  return NextResponse.json({ ok: true, prev, next: nextRefl, prevReference, reference: next.sabbath.reference, verse: next.sabbath.verse });
}
