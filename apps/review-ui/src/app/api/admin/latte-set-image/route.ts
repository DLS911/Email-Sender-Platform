/**
 * POST /api/admin/latte-set-image
 *   { issueDate, slot, imageUrl }
 *
 * Force-sets a single image slot's URL on a Latte issue. Pass imageUrl=""
 * (or null) to clear the slot — the template renders no <img> when empty.
 * Re-renders html/text/subject/preheader. Used when the generated image
 * is wrong and the regenerate-slot loop can't produce an acceptable one
 * (e.g. book cover title misspelled by the model, specific bottle label
 * generated as a sibling product).
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Slot = "hero" | "cover-detail" | "hosts-corner" | "the-drive" | "tasting-1" | "tasting-2" | "tasting-3";
const VALID: Slot[] = ["hero", "cover-detail", "hosts-corner", "the-drive", "tasting-1", "tasting-2", "tasting-3"];

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

  let body: { issueDate?: string; slot?: string; imageUrl?: string | null };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const slot = (body.slot ?? "").trim() as Slot;
  const nextUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!VALID.includes(slot)) return NextResponse.json({ error: `slot must be one of ${VALID.join(", ")}` }, { status: 400 });

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

  const sections = data.sections as (SaturdayLatteContent & { images?: Record<string, unknown> }) | null;
  if (!sections) return NextResponse.json({ error: "no sections" }, { status: 400 });

  const prevImages = (sections.images ?? {}) as Record<string, unknown>;
  const nextImages: Record<string, unknown> = { ...prevImages };

  const slotToKey: Record<Slot, string> = {
    "hero": "hero",
    "cover-detail": "coverDetail",
    "hosts-corner": "hostsCorner",
    "the-drive": "theDrive",
    "tasting-1": "tastingMenu-1",
    "tasting-2": "tastingMenu-2",
    "tasting-3": "tastingMenu-3",
  };
  const key = slotToKey[slot];
  let prevUrl: string | null = null;
  if (key.startsWith("tastingMenu-")) {
    const idx = Number(key.slice(-1)) - 1;
    const arr = Array.isArray(nextImages.tastingMenu) ? [...(nextImages.tastingMenu as string[])] : ["", "", ""];
    prevUrl = (arr[idx] ?? null) || null;
    arr[idx] = nextUrl;
    nextImages.tastingMenu = arr;
  } else {
    prevUrl = (nextImages[key] as string | undefined) ?? null;
    if (nextUrl) nextImages[key] = nextUrl;
    else delete nextImages[key];
  }

  const nextSections = { ...sections, images: nextImages } as SaturdayLatteContent;
  const rendered = renderSaturdayLatteHtml(nextSections, {
    issueDate,
    unsubscribeUrl: "https://send.castorabbott.com/unsubscribe?placeholder=1",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });

  const { error: upErr } = await db
    .from("saturday_latte_issues")
    .update({
      sections: nextSections,
      html: rendered.html,
      text_body: rendered.text,
      subject: rendered.subject,
      preheader: rendered.preheader,
    })
    .eq("issue_date", issueDate);
  if (upErr) return NextResponse.json({ error: `db update: ${upErr.message}` }, { status: 500 });

  logger.info("latte_set_image.success", { issueDate, slot, prevUrl, nextUrl: nextUrl || null });
  return NextResponse.json({ ok: true, slot, prevUrl, nextUrl: nextUrl || null });
}
