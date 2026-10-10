import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  if (!cronSecret) return NextResponse.json({ error: "no secret" }, { status: 500 });
  const q = url.searchParams.get("test");
  if (authHeader !== `Bearer ${cronSecret}` && q !== cronSecret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const issueDate = url.searchParams.get("issueDate");
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  const db = createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
  const { data, error } = await db
    .from("saturday_latte_issues")
    .select("issue_date, generated_at, cover_story_headline, sections")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const sections = (data.sections ?? {}) as Record<string, unknown>;
  const tm = Array.isArray(sections.tastingMenu) ? (sections.tastingMenu as Array<Record<string, unknown>>) : [];
  const hc = (sections.hostsCorner ?? {}) as Record<string, unknown>;
  const dr = (sections.theDrive ?? {}) as Record<string, unknown>;
  const images = (sections.images ?? {}) as Record<string, unknown>;
  const imgTasting = Array.isArray(images.tastingMenu) ? (images.tastingMenu as string[]) : [];
  return NextResponse.json({
    issue_date: data.issue_date,
    generated_at: data.generated_at,
    headline: data.cover_story_headline,
    tastingMenu: tm.map((t, i) => ({
      label: t.label,
      title: t.title,
      imageUrl: imgTasting[i] ?? null,
      body_preview: typeof t.body === "string" ? (t.body as string).slice(0, 300) : null,
    })),
    hostsCorner: {
      moveTitle: hc.moveTitle ?? null,
      imageUrl: images.hostsCorner ?? null,
      body_preview: typeof hc.moveBody === "string" ? (hc.moveBody as string).slice(0, 300) : null,
    },
    theDrive: {
      car: dr.car ?? null,
      url: dr.url ?? null,
      specs: dr.specs ?? null,
      imageUrl: images.theDrive ?? null,
    },
    heroImage: images.hero ?? null,
    slotRegenerations: Array.isArray(sections.slotRegenerations) ? (sections.slotRegenerations as unknown[]).length : 0,
  });
}
