/**
 * Curated items CRUD API.
 *
 *   GET    /api/admin/curated?status=active            → list all (grouped by kind)
 *   POST   /api/admin/curated {kind, title, notes?, reference_url?}
 *   PATCH  /api/admin/curated {id, status?, notes?, reference_url?, title?}
 *   DELETE /api/admin/curated?id=<uuid>                → hard delete
 *
 * Auth: same ?test=<CRON_SECRET> or Authorization: Bearer <CRON_SECRET>
 * pattern as the other admin endpoints.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { CURATED_KINDS, normalizeCuratedTitle, type CuratedKind } from "../../../../lib/latte-curated";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization") ?? "";
  const url = new URL(req.url);
  const querySecret = url.searchParams.get("test");
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

function db() {
  return createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
}

function isKind(v: string): v is CuratedKind {
  return (CURATED_KINDS as string[]).includes(v);
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  let query = db()
    .from("latte_curated_items")
    .select("id, kind, title, normalized_title, notes, reference_url, status, used_in_issue_date, added_by, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const grouped: Record<string, unknown[]> = { car: [], drink: [], book: [], product: [] };
  for (const row of data ?? []) {
    const kind = (row as { kind: string }).kind;
    if (isKind(kind)) grouped[kind]!.push(row);
  }
  const counts = Object.fromEntries(Object.entries(grouped).map(([k, v]) => [k, v.length]));
  return NextResponse.json({ grouped, counts });
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { kind?: string; title?: string; notes?: string; reference_url?: string; added_by?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const kind = body.kind?.trim();
  const title = body.title?.trim();
  if (!kind || !isKind(kind)) return NextResponse.json({ error: `kind must be one of: ${CURATED_KINDS.join(", ")}` }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const normalized_title = normalizeCuratedTitle(title);
  if (!normalized_title) return NextResponse.json({ error: "title normalizes to empty" }, { status: 400 });
  const insert: Record<string, unknown> = {
    kind, title, normalized_title,
    ...(body.notes ? { notes: body.notes.trim() } : {}),
    ...(body.reference_url ? { reference_url: body.reference_url.trim() } : {}),
    added_by: body.added_by?.trim() ?? "austin",
  };
  const { data, error } = await db().from("latte_curated_items").insert(insert).select().single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "duplicate — this item is already curated for this kind" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}

export async function PATCH(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { id?: string; status?: string; notes?: string; reference_url?: string; title?: string };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.status && ["active", "used", "archived"].includes(body.status)) update.status = body.status;
  if (typeof body.notes === "string") update.notes = body.notes.trim() || null;
  if (typeof body.reference_url === "string") update.reference_url = body.reference_url.trim() || null;
  if (body.title && body.title.trim()) {
    update.title = body.title.trim();
    update.normalized_title = normalizeCuratedTitle(body.title);
  }
  const { data, error } = await db().from("latte_curated_items").update(update).eq("id", body.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(req: Request): Promise<NextResponse> {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { error } = await db().from("latte_curated_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: id });
}
