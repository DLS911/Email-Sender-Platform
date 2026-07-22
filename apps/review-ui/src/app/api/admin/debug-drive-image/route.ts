/**
 * Debug endpoint that runs the full drive-image pipeline for a car +
 * editorial scene, uploads the result to a debug folder in Supabase
 * Storage, and returns the URL. Used to iterate on car reference +
 * background-edit prompts without regenerating a whole Latte issue.
 *
 *   GET /api/admin/debug-drive-image?car=2024%20BMW%20M2%20(G87)&scene=coastal%20Florida%20marina%20at%207:30am&test=<CRON_SECRET>
 *
 * Returns:
 *   {
 *     car, scene,
 *     referenceUrl,          // Wikipedia photo used as reference
 *     editedImageUrl,        // final edited image URL in storage
 *     usedEdit,              // true if Gemini edit succeeded, false if fell back to reference-direct
 *     mode: "edited" | "reference-direct" | "text-only-fallback"
 *   }
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchCarReferenceImage } from "../../../../lib/saturday-latte-car-image";
import { editDriveImageBackground } from "../../../../lib/saturday-latte-images";

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
  const car = url.searchParams.get("car")?.trim();
  const scene = url.searchParams.get("scene")?.trim() ?? "";
  if (!car) {
    return NextResponse.json({ error: "missing ?car" }, { status: 400 });
  }
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_API_KEY missing" }, { status: 500 });
  }

  try {
    // Step 1: fetch reference from Wikipedia
    const reference = await fetchCarReferenceImage(car);
    const storage = getStorage();
    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    // Upload the raw reference for comparison
    const refPath = `debug/${stamp}-reference.${extForMime(reference.mimeType)}`;
    const referenceStoredUrl = await upload(storage, refPath, reference.bytes, reference.mimeType);

    // Step 2: try the strict background-only edit
    const slotPrompt = scene || `${car} in a scenic coastal Pacific setting at golden hour, off-center rule-of-thirds composition, dry road, natural Portra 400 warmth`;
    const sectionTag = `[Saturday Morning Latte — The Drive image] Subject: the car "${car}".`;

    let mode: "edited" | "reference-direct" | "text-only-fallback" = "edited";
    let editedImageUrl = referenceStoredUrl;
    let editError: string | undefined;

    try {
      const edited = await editDriveImageBackground(
        apiKey,
        reference,
        slotPrompt,
        sectionTag,
        car,
      );
      const editedPath = `debug/${stamp}-edited.${extForMime(edited.mimeType)}`;
      editedImageUrl = await upload(storage, editedPath, edited.bytes, edited.mimeType);
      mode = "edited";
    } catch (err) {
      editError = err instanceof Error ? err.message : String(err);
      mode = "reference-direct";
    }

    return NextResponse.json({
      car,
      scene: slotPrompt,
      referenceSourceUrl: reference.sourceUrl,
      referenceStoredUrl,
      editedImageUrl,
      mode,
      ...(editError ? { editError } : {}),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "debug_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
