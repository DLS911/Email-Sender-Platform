/**
 * Image generation for Saturday Morning Latte.
 *
 * 7 images per issue, generated via OpenAI DALL-E 3 (standard quality,
 * $0.04 each = $0.28 per issue), then downloaded and uploaded to
 * Supabase Storage public bucket `latte-images` for permanent URLs.
 *
 * Why this two-step: DALL-E 3 returns temporary URLs that expire after
 * ~1 hour. The Saturday cron generates Friday night and sends Saturday
 * morning, so we must self-host.
 *
 * Image positions match published examples:
 *   1. hero — top banner under header
 *   2. coverDetail — mid-cover-story detail
 *   3-5. tastingMenu[0..2] — one per item
 *   6. hostsCorner — kitchen / cooking subject
 *   7. theDrive — the car
 */

import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

const STORAGE_BUCKET = "latte-images";
const DALLE_MODEL = "dall-e-3";
const DALLE_SIZE = "1024x1024" as const;
const DALLE_QUALITY = "standard" as const;
const DALLE_COST_PER_IMAGE = 0.04;

export type LatteImagePrompts = {
  hero: string;
  coverDetail: string;
  tastingMenu: string[]; // 3 items, one prompt per
  hostsCorner: string;
  theDrive: string;
};

export type LatteImageUrls = {
  hero?: string;
  coverDetail?: string;
  tastingMenu?: string[];
  hostsCorner?: string;
  theDrive?: string;
};

export type ImageGenResult = {
  urls: LatteImageUrls;
  costUsd: number;
  latencyMs: number;
  failures: Array<{ slot: string; error: string }>;
};

function getStorageClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("latte-images: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const LATTE_IMAGE_STYLE_SUFFIX =
  ". Editorial photography style. Warm natural lighting. Documentary feel, not stock photo. Slightly desaturated. Subtle film grain. 4:3 to square framing. NO TEXT, NO LOGOS, NO PEOPLE'S FACES visible. Atmospheric and grounded.";

async function generateOneImage(
  openai: OpenAI,
  slotPrompt: string,
): Promise<{ tmpUrl: string; revisedPrompt: string }> {
  const fullPrompt = `${slotPrompt}${LATTE_IMAGE_STYLE_SUFFIX}`;
  const response = await openai.images.generate({
    model: DALLE_MODEL,
    prompt: fullPrompt,
    n: 1,
    size: DALLE_SIZE,
    quality: DALLE_QUALITY,
    response_format: "url",
  });
  const item = response.data?.[0];
  if (!item?.url) throw new Error("dall-e: no url in response");
  return { tmpUrl: item.url, revisedPrompt: item.revised_prompt ?? "" };
}

async function downloadAndUpload(
  storage: SupabaseClient,
  tmpUrl: string,
  storagePath: string,
): Promise<string> {
  const r = await fetch(tmpUrl);
  if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
  const arrayBuffer = await r.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  const { error: uploadErr } = await storage.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: "image/png",
      upsert: true,
    });
  if (uploadErr) throw new Error(`storage upload: ${uploadErr.message}`);

  const { data: publicData } = storage.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  if (!publicData?.publicUrl) throw new Error("storage: missing publicUrl");
  return publicData.publicUrl;
}

async function generateAndStore(
  openai: OpenAI,
  storage: SupabaseClient,
  slot: string,
  prompt: string,
  issueDate: string,
): Promise<{ url: string }> {
  const dalle = await generateOneImage(openai, prompt);
  const filename = `${issueDate}/${slot}.png`;
  const publicUrl = await downloadAndUpload(storage, dalle.tmpUrl, filename);
  return { url: publicUrl };
}

export async function generateLatteImages(opts: {
  prompts: LatteImagePrompts;
  issueDate: string;
  openaiApiKey?: string;
}): Promise<ImageGenResult> {
  const start = Date.now();
  const apiKey = opts.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("latte-images: OPENAI_API_KEY missing");

  const openai = new OpenAI({ apiKey });
  const storage = getStorageClient();
  const urls: LatteImageUrls = {};
  const failures: Array<{ slot: string; error: string }> = [];

  // Define all 7 image jobs
  const jobs: Array<{
    slot: string;
    prompt: string;
    set: (url: string) => void;
  }> = [
    {
      slot: "hero",
      prompt: opts.prompts.hero,
      set: (u) => {
        urls.hero = u;
      },
    },
    {
      slot: "cover-detail",
      prompt: opts.prompts.coverDetail,
      set: (u) => {
        urls.coverDetail = u;
      },
    },
    {
      slot: "tasting-1",
      prompt: opts.prompts.tastingMenu[0] ?? "",
      set: (u) => {
        urls.tastingMenu = urls.tastingMenu ?? ["", "", ""];
        urls.tastingMenu[0] = u;
      },
    },
    {
      slot: "tasting-2",
      prompt: opts.prompts.tastingMenu[1] ?? "",
      set: (u) => {
        urls.tastingMenu = urls.tastingMenu ?? ["", "", ""];
        urls.tastingMenu[1] = u;
      },
    },
    {
      slot: "tasting-3",
      prompt: opts.prompts.tastingMenu[2] ?? "",
      set: (u) => {
        urls.tastingMenu = urls.tastingMenu ?? ["", "", ""];
        urls.tastingMenu[2] = u;
      },
    },
    {
      slot: "hosts-corner",
      prompt: opts.prompts.hostsCorner,
      set: (u) => {
        urls.hostsCorner = u;
      },
    },
    {
      slot: "the-drive",
      prompt: opts.prompts.theDrive,
      set: (u) => {
        urls.theDrive = u;
      },
    },
  ];

  // Fire all 7 in parallel — DALL-E handles concurrent requests fine
  const results = await Promise.allSettled(
    jobs.map((job) =>
      job.prompt.trim() === ""
        ? Promise.reject(new Error("empty prompt"))
        : generateAndStore(openai, storage, job.slot, job.prompt, opts.issueDate),
    ),
  );

  let successCount = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const res = results[i]!;
    if (res.status === "fulfilled") {
      job.set(res.value.url);
      successCount++;
    } else {
      failures.push({
        slot: job.slot,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  }

  return {
    urls,
    costUsd: successCount * DALLE_COST_PER_IMAGE,
    latencyMs: Date.now() - start,
    failures,
  };
}
