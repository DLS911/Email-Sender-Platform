/**
 * v0 harness single-case runner.
 *
 * GET /api/admin/harness-case?caseId=<id>&n=3
 *
 * Runs one HarnessCase through the appropriate v2 pipeline path (scene
 * route or composite-legacy delegation), uploads every candidate to
 * Supabase storage under harness-runs/{caseId}/{ts}/, and returns
 * scores + candidate URLs. The caller (bash driver) loops over case
 * IDs and compiles a summary.
 *
 * Latency budget: one case = one to N Gemini calls + N validator calls
 * + optional reference-fetch (composite). Comfortably under maxDuration.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { getCaseById, listCaseIds } from "../../../../lib/latte-v2/harness/cases";
import { generateSceneSlot } from "../../../../lib/latte-v2/scene-route";
import { generateProductOrDrinkSlot, generateCarSlot } from "../../../../lib/latte-v2/composite-route";
import type { V2ValidatorContext } from "../../../../lib/latte-v2/validator";
import { getStorageClient, uploadToStorage, extForMime } from "../../../../lib/saturday-latte-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  if (authHeader === `Bearer ${cronSecret}`) return true;
  if (querySecret && querySecret === cronSecret) return true;
  return false;
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const caseId = url.searchParams.get("caseId");
  if (!caseId) {
    return NextResponse.json({ error: "caseId required", availableCaseIds: listCaseIds() }, { status: 400 });
  }
  const c = getCaseById(caseId);
  if (!c) {
    return NextResponse.json({ error: `unknown caseId: ${caseId}`, availableCaseIds: listCaseIds() }, { status: 404 });
  }
  const nParam = url.searchParams.get("n");
  const n = nParam ? Math.max(1, Math.min(4, parseInt(nParam, 10) || 3)) : 3;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });

  const validatorCtx: V2ValidatorContext = {
    slot: c.slot,
    subject: c.subject,
    ...(c.visualFacts ? { visualFacts: c.visualFacts } : {}),
  };

  const start = Date.now();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const storage = getStorageClient();
  const HARNESS_BUCKET_PREFIX = "harness-runs";

  async function ship(slot: string, bytes: Uint8Array, mimeType: string, tag: string): Promise<string> {
    const filename = `${HARNESS_BUCKET_PREFIX}/${c!.id}/${timestamp}/${slot}-${tag}.${extForMime(mimeType)}`;
    return uploadToStorage(storage, bytes, filename, mimeType);
  }

  try {
    if (c.slot === "hero" || c.slot === "coverDetail" || c.slot === "hostsCorner") {
      const res = await generateSceneSlot({
        apiKey: anthropicKey,
        slot: c.slot,
        subject: c.subject,
        slotPrompt: c.slotPrompt,
        n,
        validatorCtx,
      });
      if (!res) return NextResponse.json({ caseId, error: "scene route returned null", latencyMs: Date.now() - start }, { status: 200 });
      const winnerUrl = await ship(c.slot, res.bytes, res.mimeType, `winner-idx${res.candidateIndex}`);
      return NextResponse.json({
        caseId,
        slot: c.slot,
        route: "scene",
        winnerUrl,
        winningScore: res.score,
        allScores: res.allScores,
        belowThreshold: res.belowThreshold,
        passed: res.score >= c.minScore,
        minScore: c.minScore,
        deductions: res.deductions,
        latencyMs: Date.now() - start,
        provenance: c.provenance,
      });
    }
    if (c.slot === "theDrive") {
      const compRes = await generateCarSlot({
        apiKey: anthropicKey,
        carName: c.subject,
        slotPrompt: c.slotPrompt,
        sectionTag: `[Harness — theDrive] ${c.subject}`,
        validatorCtx,
      });
      if (!compRes) return NextResponse.json({ caseId, error: "car route returned null", latencyMs: Date.now() - start }, { status: 200 });
      const winnerUrl = await ship("theDrive", compRes.bytes, compRes.mimeType, "candidate");
      return NextResponse.json({
        caseId,
        slot: c.slot,
        route: compRes.route,
        winnerUrl,
        winningScore: compRes.score,
        passed: compRes.score >= c.minScore,
        minScore: c.minScore,
        deductions: compRes.deductions,
        latencyMs: Date.now() - start,
        provenance: c.provenance,
        ...(compRes.referenceUrl ? { referenceUrl: compRes.referenceUrl } : {}),
      });
    }
    // Tasting menu
    const kind = c.tastingKind ?? "product";
    const tastingRes = await generateProductOrDrinkSlot({
      apiKey: anthropicKey,
      subject: c.subject,
      kind,
      slotPrompt: c.slotPrompt,
      sectionTag: `[Harness — ${c.slot}] ${c.subject}`,
      validatorCtx,
    });
    if (!tastingRes) return NextResponse.json({ caseId, error: "tasting route returned null", latencyMs: Date.now() - start }, { status: 200 });
    const winnerUrl = await ship(c.slot, tastingRes.bytes, tastingRes.mimeType, "candidate");
    return NextResponse.json({
      caseId,
      slot: c.slot,
      route: tastingRes.route,
      winnerUrl,
      winningScore: tastingRes.score,
      passed: tastingRes.score >= c.minScore,
      minScore: c.minScore,
      deductions: tastingRes.deductions,
      latencyMs: Date.now() - start,
      provenance: c.provenance,
      ...(tastingRes.referenceUrl ? { referenceUrl: tastingRes.referenceUrl } : {}),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("harness_case.fatal", { caseId, error });
    return NextResponse.json({ caseId, error, latencyMs: Date.now() - start }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  return handle(req);
}
export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
