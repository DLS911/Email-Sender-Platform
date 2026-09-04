/**
 * Rewrite a single passage of copy in an existing issue.
 *
 * POST /api/admin/rewrite-passage
 *   { issueDate, fieldPath, selectedText, feedback }
 *
 * fieldPath supports:
 *   coverStoryParagraphs.0..N
 *   tastingMenu.0..2.body
 *   hostsCorner.leadIn
 *   hostsCorner.moveBody
 *   theDrive.body
 *   sundayPrep.body
 *   sabbath.reflection
 *   ps
 *
 * Loads the current text at fieldPath, calls Sonnet with a focused
 * "rewrite this passage addressing the reviewer's flagged section"
 * instruction, replaces the text in sections JSONB, re-renders
 * HTML/text via the same template, persists.
 *
 * Returns { newText, latencyMs, editCount }.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const WRITER_MODEL = "claude-sonnet-4-5-20250929";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

type SectionPath =
  | { kind: "coverParagraph"; index: number }
  | { kind: "tastingBody"; index: number }
  | { kind: "hostsLeadIn" }
  | { kind: "hostsMoveBody" }
  | { kind: "driveBody" }
  | { kind: "sundayPrepBody" }
  | { kind: "sabbathReflection" }
  | { kind: "ps" }
  | { kind: "coverStoryHeadline" }
  | { kind: "preheader" };

function parseFieldPath(raw: string): SectionPath | null {
  const s = raw.trim();
  const m = s.match(/^coverStoryParagraphs\.(\d+)$/);
  if (m) return { kind: "coverParagraph", index: parseInt(m[1]!, 10) };
  const t = s.match(/^tastingMenu\.(\d+)\.body$/);
  if (t) return { kind: "tastingBody", index: parseInt(t[1]!, 10) };
  if (s === "hostsCorner.leadIn") return { kind: "hostsLeadIn" };
  if (s === "hostsCorner.moveBody") return { kind: "hostsMoveBody" };
  if (s === "theDrive.body") return { kind: "driveBody" };
  if (s === "sundayPrep.body") return { kind: "sundayPrepBody" };
  if (s === "sabbath.reflection") return { kind: "sabbathReflection" };
  if (s === "ps") return { kind: "ps" };
  if (s === "coverStoryHeadline") return { kind: "coverStoryHeadline" };
  if (s === "preheader") return { kind: "preheader" };
  return null;
}

function readAt(content: SaturdayLatteContent, path: SectionPath): string {
  switch (path.kind) {
    case "coverParagraph":
      return content.coverStoryParagraphs?.[path.index] ?? "";
    case "tastingBody":
      return content.tastingMenu?.[path.index]?.body ?? "";
    case "hostsLeadIn":
      return content.hostsCorner?.leadIn ?? "";
    case "hostsMoveBody":
      return content.hostsCorner?.moveBody ?? "";
    case "driveBody":
      return content.theDrive?.body ?? "";
    case "sundayPrepBody":
      return content.sundayPrep?.body ?? "";
    case "sabbathReflection":
      return content.sabbath?.reflection ?? "";
    case "ps":
      return content.ps ?? "";
    case "coverStoryHeadline":
      return content.coverStoryHeadline ?? "";
    case "preheader":
      return content.preheader ?? "";
  }
}

function writeAt(content: SaturdayLatteContent, path: SectionPath, value: string): SaturdayLatteContent {
  const next = { ...content };
  switch (path.kind) {
    case "coverParagraph": {
      const arr = [...(next.coverStoryParagraphs ?? [])];
      arr[path.index] = value;
      next.coverStoryParagraphs = arr;
      return next;
    }
    case "tastingBody": {
      const arr = [...(next.tastingMenu ?? [])];
      if (arr[path.index]) arr[path.index] = { ...arr[path.index]!, body: value };
      next.tastingMenu = arr;
      return next;
    }
    case "hostsLeadIn":
      next.hostsCorner = { ...next.hostsCorner, leadIn: value };
      return next;
    case "hostsMoveBody":
      next.hostsCorner = { ...next.hostsCorner, moveBody: value };
      return next;
    case "driveBody":
      next.theDrive = { ...next.theDrive, body: value };
      return next;
    case "sundayPrepBody":
      next.sundayPrep = { ...next.sundayPrep, body: value };
      return next;
    case "sabbathReflection":
      next.sabbath = { ...next.sabbath, reflection: value };
      return next;
    case "ps":
      next.ps = value;
      return next;
    case "coverStoryHeadline":
      next.coverStoryHeadline = value;
      return next;
    case "preheader":
      next.preheader = value;
      return next;
  }
}

function rewriteSystemPrompt(sectionLabel: string): string {
  return `You are Mark, the voice of The Saturday Morning Latte. A reviewer has flagged a specific passage of copy in the ${sectionLabel} and asked for a rewrite.

Rules for the rewrite:
- Keep the passage's LENGTH within ±20% of the original.
- Keep Mark's voice: direct, opinionated, no hedging, no travel-magazine prose, no "perhaps consider," no "a hidden gem awaits," no em dashes (use commas / periods / parentheses).
- Preserve everything not related to the flagged issue — names of specific places, restaurants, dishes, brands, cars, books, films, dates, prices, statistics. Do NOT invent new facts.
- Do NOT add meta-commentary ("this section was flagged," "here's a revised version"). Return only the rewritten passage.
- Do NOT wrap the output in quotes or code fences.
- The reviewer will drop your output DIRECTLY into the section — no preamble.`;
}

function labelForPath(path: SectionPath): string {
  switch (path.kind) {
    case "coverParagraph": return "Cover Story";
    case "tastingBody": return "Tasting Menu body";
    case "hostsLeadIn": return "Host's Corner lead-in";
    case "hostsMoveBody": return "Host's Corner move body";
    case "driveBody": return "The Drive body";
    case "sundayPrepBody": return "Sunday Prep body";
    case "sabbathReflection": return "Sabbath reflection";
    case "ps": return "P.S.";
    case "coverStoryHeadline": return "Cover Story headline";
    case "preheader": return "Preheader";
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { issueDate?: string; fieldPath?: string; selectedText?: string; feedback?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const issueDate = body.issueDate?.trim();
  const fieldPath = body.fieldPath?.trim();
  const selectedText = body.selectedText?.trim() ?? "";
  const feedback = body.feedback?.trim();
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!fieldPath) return NextResponse.json({ error: "fieldPath required" }, { status: 400 });
  if (!feedback) return NextResponse.json({ error: "feedback required" }, { status: 400 });
  const path = parseFieldPath(fieldPath);
  if (!path) return NextResponse.json({ error: `invalid fieldPath: ${fieldPath}` }, { status: 400 });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "supabase env missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false } });

  const { data: row, error: loadErr } = await db
    .from("saturday_latte_issues")
    .select("issue_date, sections, subject, preheader")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });

  const sections = (row.sections ?? {}) as Record<string, unknown>;
  const content = sections as unknown as SaturdayLatteContent;
  const currentText = readAt(content, path);
  if (!currentText) return NextResponse.json({ error: `no text at ${fieldPath}` }, { status: 400 });

  const start = Date.now();
  const client = new Anthropic({ apiKey: anthropicKey });
  const userMsg = `SECTION: ${labelForPath(path)}
FIELD PATH: ${fieldPath}

CURRENT PASSAGE (what's in the issue right now):
"""
${currentText}
"""

${selectedText ? `REVIEWER HIGHLIGHTED THIS SPECIFIC PORTION:
"""
${selectedText}
"""` : "The reviewer did not highlight a specific portion — apply the feedback to whatever part of the passage it addresses."}

REVIEWER FEEDBACK:
"""
${feedback}
"""

Rewrite the passage. Return ONLY the rewritten passage — no preamble, no markdown fences, no quotes.`;

  let newText = "";
  try {
    const response = await client.messages.create({
      model: WRITER_MODEL,
      max_tokens: 1200,
      temperature: 0.55,
      system: rewriteSystemPrompt(labelForPath(path)),
      messages: [{ role: "user", content: userMsg }],
    });
    for (const block of response.content) if (block.type === "text") newText += block.text;
    newText = newText.trim();
    if (newText.startsWith('"') && newText.endsWith('"')) newText = newText.slice(1, -1).trim();
    if (!newText) throw new Error("empty rewrite");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("rewrite_passage.sonnet_failed", { issueDate, fieldPath, error: msg });
    return NextResponse.json({ error: `rewrite failed: ${msg}` }, { status: 500 });
  }

  const nextContent = writeAt(content, path, newText);
  const rendered = renderSaturdayLatteHtml(nextContent, {
    issueDate,
    unsubscribeUrl: "{{unsubscribe_url}}",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });

  const editHistory = Array.isArray(sections.passageEdits) ? [...(sections.passageEdits as unknown[])] : [];
  editHistory.push({
    at: new Date().toISOString(),
    fieldPath,
    selectedText: selectedText.slice(0, 400),
    feedback: feedback.slice(0, 400),
    prevText: currentText.slice(0, 800),
    newText: newText.slice(0, 800),
    latencyMs: Date.now() - start,
  });

  const nextSections: Record<string, unknown> = { ...sections, ...(nextContent as unknown as Record<string, unknown>), passageEdits: editHistory };

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

  logger.info("rewrite_passage.success", { issueDate, fieldPath, latencyMs: Date.now() - start });

  return NextResponse.json({
    newText,
    fieldPath,
    latencyMs: Date.now() - start,
    editCount: editHistory.length,
  });
}
