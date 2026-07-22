/**
 * Debug endpoint for the tasting-image pipeline. Runs the full flow
 * (Wikipedia reference lookup + keyframe/poster edit + upload) for a
 * given tasting item and returns the image URL + diagnostic info.
 *
 *   GET /api/admin/debug-tasting-image
 *     ?subject=Dune:%20Part%20Two
 *     &kind=film
 *     &scene=warm%20living%20room%20movie%20night...
 *     &forceMode=keyframe    (optional: force keyframe or poster path for films)
 *     &test=<CRON_SECRET>
 *
 * Kinds: book | film | product | drink | unknown
 *
 * Returns:
 *   {
 *     subject, kind, scene,
 *     filmVisualStyle,     // Haiku's research profile for the film (if kind=film)
 *     referenceUrl,        // Wikipedia infobox image used
 *     editedImageUrl,      // Final edited image in storage
 *     usedReference,
 *   }
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  generateTastingImageWithReference,
  researchFilmVisualStyle,
} from "../../../../lib/saturday-latte-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const STORAGE_BUCKET = "Latte Images";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  if (!cronSecret) return false;
  if (authHeader === `Bearer ${cronSecret}`) return true;
  if (querySecret && querySecret === cronSecret) return true;
  return false;
}

function getStorage(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase env missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function upload(
  storage: SupabaseClient,
  path: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const { error } = await storage.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`upload: ${error.message}`);
  const { data } = storage.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("upload: no public URL");
  return data.publicUrl;
}

function extForMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const subject = url.searchParams.get("subject")?.trim();
  const kindRaw = url.searchParams.get("kind")?.trim() ?? "unknown";
  const scene = url.searchParams.get("scene")?.trim() ?? "";

  if (!subject) return NextResponse.json({ error: "missing ?subject" }, { status: 400 });

  const kind: "book" | "film" | "product" | "drink" | "unknown" =
    kindRaw === "book" || kindRaw === "film" || kindRaw === "product" || kindRaw === "drink"
      ? kindRaw
      : "unknown";

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_API_KEY missing" }, { status: 500 });
  }

  try {
    // Peek at the film-style research separately so we can show what
    // Haiku said (or that it returned null / poster fallback triggered).
    let filmVisualStyle: string | null = null;
    if (kind === "film") {
      filmVisualStyle = await researchFilmVisualStyle(subject);
    }

    const slotPrompt =
      scene ||
      (kind === "film"
        ? `A cozy home movie-night viewing setting: warm dim living room, couch with a throw blanket, coffee table with a mug of tea, soft lamp light, TV displaying the scene. Editorial evening mood.`
        : `${subject} in editorial context, warm natural light, off-center composition`);
    const sectionTag = `[Saturday Morning Latte — Tasting Menu debug] Subject: "${subject}" (kind: ${kind}).`;

    const result = await generateTastingImageWithReference(
      apiKey,
      slotPrompt,
      sectionTag,
      subject,
      kind,
    );

    const storage = getStorage();
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const path = `debug/tasting-${stamp}.${extForMime(result.mimeType)}`;
    const editedImageUrl = await upload(storage, path, result.bytes, result.mimeType);

    return NextResponse.json({
      subject,
      kind,
      scene: slotPrompt,
      filmVisualStyle,
      referenceUrl: result.referenceUrl ?? null,
      editedImageUrl,
      usedReference: result.usedReference,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "debug_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
