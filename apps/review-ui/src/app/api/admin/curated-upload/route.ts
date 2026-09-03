/**
 * Upload a reference image for a curated item.
 *
 * POST /api/admin/curated-upload (multipart/form-data)
 *   file: <image blob>       — required
 *   kind: car|drink|book|product  — required (used to prefix the storage path)
 *   title: <string>          — optional (used to sanitize filename)
 *
 * Returns: { publicUrl, path, size, mimeType }
 *
 * Bounded to 5MB and image/* only. Uses the existing "Latte Images"
 * bucket under a curated/ prefix so the URL is public and CDN-cached
 * the same as generated images.
 */

import { NextResponse } from "next/server";
import { getStorageClient, uploadToStorage, extForMime } from "../../../../lib/saturday-latte-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 5 * 1024 * 1024;

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

function sanitizeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ref";
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file field required" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "file is empty" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `file too large (${file.size} bytes, max ${MAX_BYTES})` }, { status: 400 });
  const mimeType = file.type || "application/octet-stream";
  if (!mimeType.startsWith("image/")) return NextResponse.json({ error: `not an image (mimeType=${mimeType})` }, { status: 400 });

  const kindRaw = form.get("kind");
  const kind = typeof kindRaw === "string" && ["car", "drink", "book", "product"].includes(kindRaw) ? kindRaw : "misc";
  const titleRaw = form.get("title");
  const title = typeof titleRaw === "string" ? titleRaw : "";
  const slug = sanitizeSlug(title);
  const ts = Date.now();
  const ext = extForMime(mimeType);
  const path = `curated/${kind}/${ts}-${slug}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const storage = getStorageClient();
  try {
    const publicUrl = await uploadToStorage(storage, bytes, path, mimeType);
    return NextResponse.json({ publicUrl, path, size: file.size, mimeType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `upload failed: ${msg}` }, { status: 500 });
  }
}
