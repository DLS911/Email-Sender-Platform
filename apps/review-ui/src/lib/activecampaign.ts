/**
 * ActiveCampaign API v3 client. Wraps just the endpoints we need for
 * pushing a rendered issue as a Campaign + building a launch list.
 *
 * Docs: https://developers.activecampaign.com/reference
 *
 * Auth: `Api-Token: <token>` header.
 * Base: process.env.AC_API_URL (e.g. https://castorabbott.api-us1.com).
 * Endpoints under /api/3/.
 */

type Json = Record<string, unknown>;

function envRequire(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`activecampaign: ${name} missing`);
  return v;
}

function baseUrl(): string {
  const u = envRequire("AC_API_URL").replace(/\/$/, "");
  return `${u}/api/3`;
}

async function acFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = envRequire("AC_API_TOKEN");
  const url = `${baseUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Api-Token": token,
      "Accept": "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function acJson<T = Json>(path: string, init?: RequestInit): Promise<T> {
  const res = await acFetch(path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AC ${init?.method ?? "GET"} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ── Types (only what we use) ────────────────────────────────────────

export type ACSegment = { id: string; name: string; series_id?: string };
export type ACList = { id: string; name: string; stringid?: string; sender_addr1?: string };
export type ACContact = { id: string; email: string; firstName?: string; lastName?: string };
export type ACMessage = { id: string; name: string; subject: string };
export type ACCampaign = { id: string; name: string; status: string };

// ── Segments (aka "advanced search" segments) ───────────────────────

export async function listSegments(): Promise<ACSegment[]> {
  const data = await acJson<{ segments?: Array<Record<string, unknown>> }>("/segments?limit=100");
  return (data.segments ?? []).map((s) => ({
    id: String(s.id ?? ""),
    name: String(s.name ?? ""),
    ...(s.series_id ? { series_id: String(s.series_id) } : {}),
  }));
}

// ── Lists ───────────────────────────────────────────────────────────

export async function listLists(): Promise<ACList[]> {
  const data = await acJson<{ lists?: Array<Record<string, unknown>> }>("/lists?limit=100");
  return (data.lists ?? []).map((l) => ({
    id: String(l.id ?? ""),
    name: String(l.name ?? ""),
    ...(l.stringid ? { stringid: String(l.stringid) } : {}),
    ...(l.sender_addr1 ? { sender_addr1: String(l.sender_addr1) } : {}),
  }));
}

export async function createList(input: {
  name: string;
  senderUrl: string;
  senderRemindMe: string; // one-line reason recipients get this list — required by AC
  senderAddress1: string;
  senderCity: string;
  senderZip: string;
  senderCountry: string;
}): Promise<ACList> {
  const body = {
    list: {
      name: input.name,
      stringid: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40),
      sender_url: input.senderUrl,
      sender_reminder: input.senderRemindMe,
      sender_addr1: input.senderAddress1,
      sender_city: input.senderCity,
      sender_zip: input.senderZip,
      sender_country: input.senderCountry,
    },
  };
  const data = await acJson<{ list: Record<string, unknown> }>("/lists", { method: "POST", body: JSON.stringify(body) });
  return { id: String(data.list.id ?? ""), name: String(data.list.name ?? "") };
}

// ── Contacts ────────────────────────────────────────────────────────

/**
 * Page through contacts belonging to a segment. AC uses offset-based
 * paging with a limit cap of 100 per request.
 */
export async function listContactsInSegment(segmentId: string | number, hardCap = 500): Promise<ACContact[]> {
  const all: ACContact[] = [];
  const pageSize = 100;
  let offset = 0;
  while (all.length < hardCap) {
    const data = await acJson<{ contacts?: Array<Record<string, unknown>>; meta?: { total?: string | number } }>(
      `/contacts?segmentid=${encodeURIComponent(String(segmentId))}&limit=${pageSize}&offset=${offset}`,
    );
    const rows = data.contacts ?? [];
    for (const r of rows) {
      all.push({
        id: String(r.id ?? ""),
        email: String(r.email ?? ""),
        ...(r.firstName ? { firstName: String(r.firstName) } : {}),
        ...(r.lastName ? { lastName: String(r.lastName) } : {}),
      });
      if (all.length >= hardCap) break;
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

export async function addContactToList(contactId: string | number, listId: string | number): Promise<void> {
  const body = { contactList: { contact: String(contactId), list: String(listId), status: 1 } };
  await acJson("/contactLists", { method: "POST", body: JSON.stringify(body) });
}

// ── Messages + Campaigns ────────────────────────────────────────────

export async function createMessage(input: {
  subject: string;
  html: string;
  text?: string;
  fromAddress: string;
  fromName: string;
  listId: string | number;
}): Promise<ACMessage> {
  const body = {
    message: {
      format: "mime",
      subject: input.subject,
      fromemail: input.fromAddress,
      fromname: input.fromName,
      reply2: input.fromAddress,
      html: input.html,
      text: input.text ?? "",
      // AC requires a list association on the message
      list: String(input.listId),
    },
  };
  const data = await acJson<{ message: Record<string, unknown> }>("/messages", { method: "POST", body: JSON.stringify(body) });
  return {
    id: String(data.message.id ?? ""),
    name: String(data.message.name ?? ""),
    subject: String(data.message.subject ?? ""),
  };
}

/**
 * Create a campaign. `sdate` schedules the send; omit for a draft that
 * requires manual send from the AC UI.
 */
export async function createCampaign(input: {
  name: string;
  listId: string | number;
  messageId: string | number;
  fromAddress: string;
  fromName: string;
  sendAtISO?: string;
}): Promise<ACCampaign> {
  const body = {
    campaign: {
      type: "single",
      name: input.name,
      status: input.sendAtISO ? 1 : 0, // 0=draft, 1=scheduled
      p: { [String(input.listId)]: String(input.listId) },
      m: { [String(input.messageId)]: 100 }, // 100% of recipients get this message
      ...(input.sendAtISO ? { sdate: input.sendAtISO } : {}),
      fromname: input.fromName,
      fromemail: input.fromAddress,
    },
  };
  const data = await acJson<{ campaign: Record<string, unknown> }>("/campaigns", { method: "POST", body: JSON.stringify(body) });
  return {
    id: String(data.campaign.id ?? ""),
    name: String(data.campaign.name ?? ""),
    status: String(data.campaign.status ?? ""),
  };
}
