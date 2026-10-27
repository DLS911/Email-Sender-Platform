/**
 * GET /api/admin/dg-dump?issueDate=YYYY-MM-DD
 *
 * Returns the sections structure for a Daily Grind issue so we can
 * inspect what's in firstPull.paragraphs / mainContent.howTo without
 * loading the full HTML.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const issueDate = url.searchParams.get("issueDate");
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });
  const { data, error } = await db
    .from("daily_grind_issues")
    .select("issue_date, generated_at, headline, subject, preheader, approval_status, sections, generation_meta, model, input_tokens, output_tokens, cost_usd, latency_ms")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });
  const s = (data.sections ?? {}) as Record<string, unknown>;
  const gm = (data.generation_meta ?? {}) as Record<string, unknown>;
  // Pull the subset of pipeline stages that matter for debugging negative-
  // framing drift (theMove gate + headline rewrite + voice review).
  const pipeline = Array.isArray(gm.pipeline) ? (gm.pipeline as Array<Record<string, unknown>>) : [];
  const relevantStages = pipeline
    .filter((p) => {
      const n = typeof p.name === "string" ? p.name : "";
      return (
        n === "the_move_check" ||
        n === "the_move_regen" ||
        n === "style_pass" ||
        n === "editor_pass" ||
        n === "voice_review" ||
        n === "voice_sharpen" ||
        n === "persona_panel" ||
        n === "headline_rewrite" ||
        n === "audience_evaluation" ||
        n === "repetition_review"
      );
    })
    .map((p) => ({
      name: p.name,
      status: p.status,
      latencyMs: p.latencyMs,
      notes: typeof p.notes === "string" ? p.notes.slice(0, 400) : p.notes,
    }));
  return NextResponse.json({
    issue_date: data.issue_date,
    headline: data.headline,
    subject: data.subject,
    preheader: data.preheader ?? null,
    approval_status: data.approval_status ?? null,
    model: data.model,
    input_tokens: data.input_tokens,
    output_tokens: data.output_tokens,
    cost_usd: data.cost_usd,
    latency_ms: data.latency_ms,
    theMove: s.theMove ?? null,
    openingTrifecta_theNumber: (s.openingTrifecta as { theNumber?: unknown } | undefined)?.theNumber ?? null,
    firstPull: s.firstPull ?? null,
    mainContent: s.mainContent ?? null,
    ancientTruth: s.ancientTruth ?? null,
    ps: s.ps ?? null,
    pipeline: relevantStages,
  });
}
