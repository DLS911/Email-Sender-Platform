/**
 * Regenerate a single image slot on an existing Saturday Latte issue.
 * Reviewer flags one slot as bad → this endpoint re-runs image gen for
 * that slot only, updates sections.images[slot], and re-renders the
 * issue HTML/text. The rest of the issue is untouched.
 *
 * POST /api/admin/regenerate-slot
 *   { "issueDate": "2026-09-05", "slot": "the-drive" }
 *
 * slot values: "hero" | "cover-detail" | "hosts-corner" | "the-drive"
 *              | "tasting-1" | "tasting-2" | "tasting-3"
 *
 * Returns the new image URL + a diff of what changed. Records the
 * regeneration attempt in sections.slotRegenerations so we can see
 * the history.
 */

import { NextResponse } from "next/server";
import { logger } from "@platform/observability";
import { createClient } from "@supabase/supabase-js";
import type { SaturdayLatteContent } from "../../../../lib/saturday-latte-html-template";
import { renderSaturdayLatteHtml } from "../../../../lib/saturday-latte-html-template";
import {
  generateForSlot,
  getStorageClient,
  uploadToStorage,
  extForMime,
  callGemini,
  type LatteImageSubjects,
} from "../../../../lib/saturday-latte-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Slot = "hero" | "cover-detail" | "hosts-corner" | "the-drive" | "tasting-1" | "tasting-2" | "tasting-3";
const VALID_SLOTS: Slot[] = ["hero", "cover-detail", "hosts-corner", "the-drive", "tasting-1", "tasting-2", "tasting-3"];

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

function slotToImageKey(slot: Slot): "hero" | "coverDetail" | "hostsCorner" | "theDrive" | "tastingMenu-1" | "tastingMenu-2" | "tastingMenu-3" {
  switch (slot) {
    case "hero": return "hero";
    case "cover-detail": return "coverDetail";
    case "hosts-corner": return "hostsCorner";
    case "the-drive": return "theDrive";
    case "tasting-1": return "tastingMenu-1";
    case "tasting-2": return "tastingMenu-2";
    case "tasting-3": return "tastingMenu-3";
  }
}

async function handle(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { issueDate?: string; slot?: string; promptOverride?: string; criticism?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const issueDate = body.issueDate?.trim();
  const slot = body.slot?.trim() as Slot;
  if (!issueDate) return NextResponse.json({ error: "issueDate required" }, { status: 400 });
  if (!slot || !VALID_SLOTS.includes(slot)) {
    return NextResponse.json({ error: `slot must be one of: ${VALID_SLOTS.join(", ")}` }, { status: 400 });
  }
  const googleKeyRaw = process.env.GOOGLE_API_KEY;
  if (!googleKeyRaw) return NextResponse.json({ error: "GOOGLE_API_KEY missing" }, { status: 500 });
  const googleKey: string = googleKeyRaw;

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) return NextResponse.json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" }, { status: 500 });
  const db = createClient(supaUrl, supaKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Load the issue row.
  const { data: row, error: loadErr } = await db
    .from("saturday_latte_issues")
    .select("issue_date, sections, subject, cover_story_headline, preheader")
    .eq("issue_date", issueDate)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: `no issue for ${issueDate}` }, { status: 404 });

  const sections = (row.sections ?? {}) as Record<string, unknown>;
  const content = sections as unknown as SaturdayLatteContent;

  // Rebuild subjects the way generation does.
  const subjects: LatteImageSubjects = {
    coverStoryLocation: content.coverStoryHeadline ?? "",
    tastingMenuTitles: [
      content.tastingMenu?.[0]?.title ?? "",
      content.tastingMenu?.[1]?.title ?? "",
      content.tastingMenu?.[2]?.title ?? "",
    ],
    tastingMenuLabels: [
      content.tastingMenu?.[0]?.label ?? "",
      content.tastingMenu?.[1]?.label ?? "",
      content.tastingMenu?.[2]?.label ?? "",
    ],
    hostsCornerMove: content.hostsCorner?.moveTitle ?? "",
    hostsCornerBody: `${content.hostsCorner?.leadIn ?? ""} ${content.hostsCorner?.moveBody ?? ""}`.trim(),
    theDriveCar: content.theDrive?.car ?? "",
  };

  // Pick the prompt from the stored writer output, or the caller override.
  const imagePrompts = (sections.imagePrompts ?? sections.generation_meta) as { hero?: string; coverDetail?: string; tastingMenu?: string[]; hostsCorner?: string; theDrive?: string } | undefined;
  let prompt = body.promptOverride?.trim() ?? "";
  if (!prompt) {
    // Fall back to a minimal per-slot prompt derived from subjects.
    switch (slot) {
      case "hero":
        prompt = imagePrompts?.hero ?? `Editorial hero photograph of ${subjects.coverStoryLocation}, natural light, off-center rule-of-thirds framing, no people, square 1:1.`;
        break;
      case "cover-detail":
        prompt = imagePrompts?.coverDetail ?? `Second scenic shot of ${subjects.coverStoryLocation}, different angle from the hero, editorial framing, no crowds.`;
        break;
      case "hosts-corner":
        prompt = imagePrompts?.hostsCorner ?? `Editorial food photograph of ${subjects.hostsCornerMove}, natural window light, no hands, food on a real surface.`;
        break;
      case "the-drive":
        prompt = imagePrompts?.theDrive ?? `Editorial photograph of a ${subjects.theDriveCar}, correct generation, parked, natural perspective.`;
        break;
      case "tasting-1":
      case "tasting-2":
      case "tasting-3": {
        const idx = slot === "tasting-1" ? 0 : slot === "tasting-2" ? 1 : 2;
        prompt = imagePrompts?.tastingMenu?.[idx] ?? `Editorial photograph of "${subjects.tastingMenuTitles[idx]}" on a real surface with warm side-window light.`;
        break;
      }
    }
  }

  const sectionTag = `[Saturday Morning Latte — ${slot} regen] Subject: "${
    slot === "hero" || slot === "cover-detail" ? subjects.coverStoryLocation
    : slot === "hosts-corner" ? subjects.hostsCornerMove
    : slot === "the-drive" ? subjects.theDriveCar
    : subjects.tastingMenuTitles[slot === "tasting-1" ? 0 : slot === "tasting-2" ? 1 : 2]
  }"`;

  // Compute prevUrl first — we need it BOTH as the record-keeping value
  // AND (when a criticism is provided) as the input reference for an
  // edit-mode Gemini call so the reviewer's "remove the people" note
  // surgically edits the previous frame instead of re-rolling a new
  // scene from scratch.
  const images = ((content as unknown as { images?: Record<string, unknown> }).images ?? {}) as Record<string, unknown>;
  const key = slotToImageKey(slot);
  const prevUrl = key.startsWith("tastingMenu-")
    ? Array.isArray(images.tastingMenu) ? (images.tastingMenu as string[])[Number(key.slice(-1)) - 1] ?? null : null
    : (images[key] as string | undefined) ?? null;

  const criticism = body.criticism?.trim() ?? "";
  const editMode = Boolean(criticism && prevUrl);
  let mode: "edit" | "regen" = editMode ? "edit" : "regen";

  const promptFromScratch = criticism
    ? `${prompt}

CRITICAL FIX — REVIEWER FEEDBACK ON THE PREVIOUS RENDER: ${criticism}

Do NOT repeat the mistake described above. Address it directly in this new attempt.`
    : prompt;

  async function editModeFromPrev(): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    if (!prevUrl) return null;
    try {
      const dl = await fetch(prevUrl, { method: "GET" });
      if (!dl.ok) throw new Error(`prev image fetch HTTP ${dl.status}`);
      const dlBytes = new Uint8Array(await dl.arrayBuffer());
      const dlMime = (dl.headers.get("content-type") ?? "image/png").split(";")[0]?.trim() ?? "image/png";
      const editInstruction = `Take this exact image and apply this specific correction: ${criticism}.

PRESERVE EVERYTHING ELSE about the source image — same subject, same composition, same camera angle, same lighting direction, same colors, same background, same overall mood. Only change what the correction explicitly calls out; do not re-imagine the scene.

If the correction is "remove the people", keep every other element (buildings, lighting, sky, foreground detail) identical and simply remove the human figures, filling in the space they occupied with plausible extensions of the surrounding scene. If the correction is "wheels too small", keep the car's angle / color / setting identical and enlarge the wheels to match the correct proportions. If the correction is "book was open", keep the book's cover art / table / lighting identical and render the book closed, cover-up.

The output must be a 1:1 square aspect ratio image.`;
      const b64 = Buffer.from(dlBytes).toString("base64");
      const geminiMime = dlMime === "image/jpg" ? "image/jpeg" : dlMime;
      const edited = await callGemini(googleKey, [
        { text: editInstruction },
        { inlineData: { mimeType: geminiMime, data: b64 } },
      ]);
      logger.info("regenerate_slot.edit_mode_success", { issueDate, slot, criticism: criticism.slice(0, 120) });
      return { bytes: edited.bytes, mimeType: edited.mimeType };
    } catch (err) {
      logger.warn("regenerate_slot.edit_mode_failed_falling_back", {
        issueDate, slot, error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  const start = Date.now();
  let generatedBytes: { bytes: Uint8Array; mimeType: string; usedReference?: boolean; referenceUrl?: string };
  try {
    if (editMode) {
      const editRes = await editModeFromPrev();
      if (editRes) {
        generatedBytes = editRes;
      } else {
        mode = "regen";
        generatedBytes = await generateForSlot(googleKey, slot, promptFromScratch, sectionTag, subjects);
      }
    } else {
      generatedBytes = await generateForSlot(googleKey, slot, promptFromScratch, sectionTag, subjects);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("regenerate_slot.gen_failed", { issueDate, slot, error: msg });
    return NextResponse.json({ error: `image generation failed: ${msg}` }, { status: 500 });
  }

  // Upload.
  const storage = getStorageClient();
  const genStamp = String(Math.floor(Date.now() / 1000));
  const filename = `${issueDate}/regen-${slot}-${genStamp}.${extForMime(generatedBytes.mimeType)}`;
  let publicUrl: string;
  try {
    publicUrl = await uploadToStorage(storage, generatedBytes.bytes, filename, generatedBytes.mimeType);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("regenerate_slot.upload_failed", { issueDate, slot, error: msg });
    return NextResponse.json({ error: `upload failed: ${msg}` }, { status: 500 });
  }
  const newImages: Record<string, unknown> = { ...images };
  if (key.startsWith("tastingMenu-")) {
    const idx = Number(key.slice(-1)) - 1;
    const arr = Array.isArray(newImages.tastingMenu) ? [...(newImages.tastingMenu as string[])] : ["", "", ""];
    arr[idx] = publicUrl;
    newImages.tastingMenu = arr;
  } else {
    newImages[key] = publicUrl;
  }

  const regenHistory = Array.isArray(sections.slotRegenerations) ? [...(sections.slotRegenerations as unknown[])] : [];
  regenHistory.push({
    slot,
    at: new Date().toISOString(),
    mode,
    prevUrl,
    newUrl: publicUrl,
    prompt: prompt.slice(0, 500),
    latencyMs: Date.now() - start,
    ...(body.promptOverride ? { promptOverride: true } : {}),
    ...(criticism ? { criticism } : {}),
  });

  const updatedContent: SaturdayLatteContent = { ...content, images: newImages as never };
  const rendered = renderSaturdayLatteHtml(updatedContent, {
    issueDate,
    unsubscribeUrl: "{{unsubscribe_url}}",
    webArchiveUrl: "https://castorabbott.com/newsletter/latte/",
  });

  const nextSections = { ...sections, images: newImages, slotRegenerations: regenHistory };

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

  logger.info("regenerate_slot.success", { issueDate, slot, prevUrl, newUrl: publicUrl, latencyMs: Date.now() - start });

  return NextResponse.json({
    issueDate,
    slot,
    prevUrl,
    newUrl: publicUrl,
    latencyMs: Date.now() - start,
    regenerationCount: regenHistory.length,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handle(req);
}
