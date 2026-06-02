/**
 * Unsubscribe endpoint (item J — CAN-SPAM compliance).
 *
 * GET  → human-clicked footer link; shows a confirmation page.
 * POST → RFC 8058 one-click unsubscribe (the List-Unsubscribe-Post path).
 *
 * Both: validate HMAC token, mark the subscriber inactive on the named list,
 * and add a global row to suppression_list (UNIQUE on email — upsert-safe).
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyUnsubscribeToken } from "../../../lib/unsubscribe-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAILY_GRIND_TABLE = "daily_grind_test_subscribers";
const LATTE_TABLE = "saturday_latte_subscribers";

function getDb() {
  return createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false } },
  );
}

async function doUnsubscribe(
  email: string,
  list: "daily-grind" | "latte",
): Promise<{ ok: boolean; reason?: string }> {
  const db = getDb();
  const normalized = email.trim().toLowerCase();

  // 1. Deactivate on the relevant list. We use ilike for case-insensitive match
  //    because subscribers may be stored with original casing.
  const table = list === "daily-grind" ? DAILY_GRIND_TABLE : LATTE_TABLE;
  const { error: deactErr } = await db
    .from(table)
    .update({
      active: false,
      notes: `Unsubscribed via emailed link at ${new Date().toISOString()}`,
    })
    .ilike("email", normalized);
  if (deactErr) return { ok: false, reason: `deactivate failed: ${deactErr.message}` };

  // 2. Add to global suppression_list (unique on email — ignore conflict).
  const { error: suppErr } = await db.from("suppression_list").upsert(
    {
      email: normalized,
      reason: "user_unsubscribe",
      source_brand_id: "castor_abbott",
      global: true,
      notes: `unsubscribed from list=${list}`,
    },
    { onConflict: "email", ignoreDuplicates: true },
  );
  if (suppErr) return { ok: false, reason: `suppress failed: ${suppErr.message}` };

  return { ok: true };
}

function parseParams(req: Request, urlSearchParams?: URLSearchParams): {
  email: string | undefined;
  list: "daily-grind" | "latte" | undefined;
  token: string | undefined;
} {
  const sp = urlSearchParams ?? new URL(req.url).searchParams;
  const email = sp.get("email") ?? undefined;
  const rawList = sp.get("list") ?? undefined;
  const list: "daily-grind" | "latte" | undefined =
    rawList === "daily-grind" || rawList === "latte" ? rawList : undefined;
  const token = sp.get("token") ?? undefined;
  return { email, list, token };
}

function htmlPage(title: string, body: string, statusOk = true): NextResponse {
  const colour = statusOk ? "#0a7f3f" : "#b8651a";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:80px auto;padding:0 24px;color:#2d2926;line-height:1.5}
  h1{font-family:Georgia,serif;color:${colour};margin-bottom:16px}
  p{font-size:16px}
</style></head><body>
<h1>${title}</h1>
${body}
</body></html>`;
  return new NextResponse(html, {
    status: statusOk ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: Request): Promise<NextResponse> {
  const { email, list, token } = parseParams(req);
  if (!email || !list || !token) {
    return htmlPage("Unsubscribe link invalid", "<p>This unsubscribe link is missing required fields.</p>", false);
  }
  if (!verifyUnsubscribeToken(email, list, token)) {
    return htmlPage("Unsubscribe link invalid", "<p>This unsubscribe link could not be verified. It may have been tampered with or it's from a different deployment.</p>", false);
  }
  const result = await doUnsubscribe(email, list);
  if (!result.ok) {
    return htmlPage("Something went wrong", `<p>We couldn't process the unsubscribe right now (${result.reason ?? "unknown error"}). Please reply to the email and we'll handle it manually.</p>`, false);
  }
  return htmlPage(
    "You're unsubscribed.",
    `<p><strong>${email}</strong> has been removed from the ${list === "daily-grind" ? "Daily Grind" : "Saturday Morning Latte"} list and added to the suppression list. You won't receive further sends.</p>
<p style="color:#888;font-size:14px;margin-top:32px">If this was a mistake, just reply to any prior email and we'll put you back on.</p>`,
  );
}

export async function POST(req: Request): Promise<NextResponse> {
  // RFC 8058 one-click — params may be query OR form-encoded body.
  let email: string | undefined;
  let list: "daily-grind" | "latte" | undefined;
  let token: string | undefined;
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      const body = await req.text();
      const params = new URLSearchParams(body);
      ({ email, list, token } = parseParams(req, params));
      // Also accept query params overriding body, for safety.
      const q = parseParams(req);
      email = email ?? q.email;
      list = list ?? q.list;
      token = token ?? q.token;
    } else {
      ({ email, list, token } = parseParams(req));
    }
  } catch {
    ({ email, list, token } = parseParams(req));
  }
  if (!email || !list || !token) {
    return NextResponse.json({ error: "missing email/list/token" }, { status: 400 });
  }
  if (!verifyUnsubscribeToken(email, list, token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }
  const result = await doUnsubscribe(email, list);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "unsubscribe_failed" }, { status: 500 });
  }
  return NextResponse.json({ unsubscribed: email, list });
}
