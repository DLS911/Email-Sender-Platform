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
  return NextResponse.json({
    issue_date: data.issue_date,
    generated_at: data.generated_at,
    headline: data.cover_story_headline,
    tastingMenu: tm.map((t) => ({
      label: t.label,
      title: t.title,
      body_preview: typeof t.body === "string" ? (t.body as string).slice(0, 400) : null,
    })),
    slotRegenerations: Array.isArray(sections.slotRegenerations) ? (sections.slotRegenerations as unknown[]).length : 0,
  });
}
