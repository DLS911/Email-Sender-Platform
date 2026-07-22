/**
 * Image generation for Saturday Morning Latte — Google Gemini 2.5 Flash
 * Image ("Nano Banana"). Cheaper and faster than DALL-E 3 with comparable
 * editorial quality.
 *
 * Pricing: ~$0.039 per image (1290 output tokens at $30/M).
 * 7 images per issue = ~$0.27 (similar to DALL-E but much faster +
 * better at following editorial photography style prompts).
 *
 * Generated images are returned as base64 inline data in the API response.
 * We decode and upload to Supabase Storage public bucket `latte-images` for
 * permanent URLs (the model does not host images for us).
 *
 * 7 image slots:
 *   1. hero — top banner under header
 *   2. coverDetail — mid-cover-story detail
 *   3-5. tastingMenu[0..2] — one per item
 *   6. hostsCorner — kitchen / cooking subject
 *   7. theDrive — the car
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { fetchCarReferenceImage } from "./saturday-latte-car-image";

const STORAGE_BUCKET = "Latte Images";
const GEMINI_MODEL = "gemini-2.5-flash-image";
const GEMINI_ENDPOINT = (model: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
const COST_PER_IMAGE = 0.039;

export type LatteImagePrompts = {
  hero: string;
  coverDetail: string;
  tastingMenu: string[]; // 3 items, one prompt per
  hostsCorner: string;
  theDrive: string;
};

// Section+subject metadata prepended to every Gemini prompt to lock the
// rendered image to the correct slot. Prevents two similar-category
// tasting menu items (e.g., two coffee-adjacent picks) from rendering
// as interchangeable images. Subjects are pulled from writer content.
export type LatteImageSubjects = {
  coverStoryLocation: string; // e.g., "Lanesboro, Minnesota"
  tastingMenuTitles: string[]; // 3 titles, one per tasting menu slot
  hostsCornerMove: string; // e.g., "The Cold-Start Cast Iron Steak"
  theDriveCar: string; // e.g., "2024 Porsche 911 Carrera T (992)"
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
  /** For theDrive slot: URL of the OEM press photo Haiku selected. Null if lookup failed and we fell back to text-only Gemini. */
  driveReferenceUrl?: string | null;
  /** True if the drive slot was populated from a press photo (accuracy guaranteed); false if it fell back to text-only Gemini (may be inaccurate). */
  driveUsedReference?: boolean;
};

function getStorageClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("latte-images: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Style suffix — appended to every writer-supplied prompt before Gemini
// renders. Deliberately calibrated AWAY from the AI-editorial default look
// (flat "slightly desaturated + subtle film grain" plates) and TOWARD real
// editorial photography (Garden & Gun / Kinfolk / National Geographic
// Traveler register). Tuned 2026-07-09 after Mark flagged images as AI-ish.
const LATTE_IMAGE_STYLE_SUFFIX =
  `.

=== NON-NEGOTIABLE NEGATIVES (READ BEFORE COMPOSING) ===

**NO SPURIOUS FOOD DEBRIS.** If the frame is NOT a plated meal, active food preparation, or a table clearly set for eating, do NOT add ANY food particles — no crumbs, no tater tots, no bread bits, no cracker fragments, no pastry pieces, no cookie chunks, no cereal, no popcorn, no chip fragments, no scattered nuts or berries. This rule applies especially to still-life frames like books, coffee cups, tools, pens, notebooks, single objects on a table. A coffee cup next to a book is NOT a meal — no crumbs. A book by a window is NOT a meal — no crumbs. A pocket knife on a workbench is NOT a meal — no crumbs. Food debris on a non-food frame reads as AI-hallucinated garbage and is the #1 tell that an AI generated the image.

**NO GLASSY / UNIFORM WATER.** Real water surfaces have wind-driven ripple texture, directional wave patterns, subtle color variation from depth and reflection, and imperfect reflections. Do NOT render water as a smooth glass-mirror gradient. Bays, harbors, lakes, and oceans should show visible surface texture — small waves, wind lanes, real reflections that break at wave crests, not a flat AI-perfect reflection.

**NO UNIFORM ATMOSPHERIC HAZE.** Fog, mist, and morning atmosphere have STRUCTURE — banks that hang over the water in bands, patches that break around trees or buildings, directional layers. Do NOT render fog as a smooth gray gradient that fades uniformly from foreground to background. If the frame has atmosphere, it must have shape and directionality — you should be able to say "the fog is heavier over the water on the right side" or "the mist is clearing over the harbor as the sun comes up."

**NO SCUFFED OR MANGLED BRAND LOGOS.** If a brand logo would appear in the frame (car badging, product labels), either (a) render it correctly and legibly, or (b) shoot the frame from an angle where the logo is not visible or is small enough to be indistinct. Never render a garbled / half-formed / smudged version of a real logo. If in doubt, choose the angle that hides the badging.

**PHYSICS MUST BE REAL.** The image must obey basic physics of the objects in it.
- **Steam only escapes from open apertures.** A kettle with the lid CLOSED does not vent steam from under the lid or through the metal body. Steam comes out of the open spout, or from a lid that is visibly ajar, or from a pot with no lid on. If depicting a kettle with a closed lid, the steam must be zero or come only from the spout.
- **Shadows fall in the direction the primary light source dictates.** If sun is coming from camera-right, shadows fall to the left. Never have contradictory shadow directions in the same frame.
- **Reflections match the camera viewpoint.** A polished surface reflects what would actually be in front of it from the camera's angle, not a random scene.
- **Liquids sit level in vessels regardless of vessel tilt** (Earth gravity). A tilted cup shows liquid at a level angle, not tilted with the cup.
- **Hot pans show heat effects appropriately.** Steam only from wet food or actively boiling water; not from a dry cast iron with a raw steak just placed on it.
- **Fabric drapes with weight and gravity.** Linen falls in soft folds toward the floor, not defying gravity.

**KITCHEN LOGIC (for Host's Corner and any food frame).**
- **Hot cookware sits on a heat-appropriate surface.** A cast iron skillet, hot pan, or dutch oven that's actively cooking goes on the STOVE. A hot pan that's been removed from the stove goes on a TRIVET, a STONE surface, an INDUCTION mat, or a cast iron rack. It NEVER goes directly on bare wood — that would burn/scar the wood. If depicting an active cooking scene, put the pan on the stove; if depicting a finished/plated dish, the pan should be off-frame or on a trivet.
- **Grease, oil, and cooking liquids appear only where cooking would produce them.** Inside the pan (rendered fat, sauce, glaze) or on the food itself (pan drippings on a plated steak). NOT as random puddles on the cutting board, counter, or table adjacent to the pan. A grease puddle sitting on bare wood next to a pan is nonsensical — cooks would wipe it up immediately, and no cooking process deposits grease onto adjacent surfaces.
- **Cutting boards and counters stay clean** except for the specific food or action shown. A prep scene shows the ingredient being prepped and small realistic debris FROM THAT PREP (garlic paper flakes from crushing garlic, a few onion skins from mincing onion). Not random unrelated bits.
- **Utensils and tools appear only where they'd realistically be.** A whisk in a mixing bowl is fine. A whisk sitting alone on a windowsill next to a coffee cup is nonsensical.

**HUMAN SUBJECT PERSPECTIVE (for any frame containing people).**
- **People doing actions face the object of their action.** A tennis player is oriented toward the ball or the other player. A cook is looking at the pan or the ingredient. A reader's gaze falls on the book. A driver looks at the road.
- **If depicting a movie or TV scene, the subjects in the frame respect the actual composition of that scene.** Actors in Challengers face each other during a tennis rally, not away. Actors in a two-person conversation face each other or a middle point.
- **Bodies orient consistently with actions.** A tennis player mid-swing has racquet, arm, and gaze all aligned toward the ball. Not disconnected body parts pointing different directions.
- **No zombie stares.** Human faces looking at nothing in particular in the middle distance are the classic AI tell. Either the person's gaze has a clear target in the frame, or the person is turned away / photographed from behind / silhouette-only.
- If the correct perspective is hard to render, prefer angles that show the person from behind, in silhouette, or with the face partially obscured — that avoids the mid-distance zombie stare entirely.

=== EDITORIAL STYLE ===

Shoot in the style of Garden & Gun, Kinfolk, or National Geographic Traveler — real editorial photography by a photographer with taste. Medium-format film aesthetic: Portra 400 warmth for humans, interiors, and food; Ektar 100 for landscape. Colors feel lived-in, not filtered — warm skin tones, natural greens, honest blues. Motivated light with specific character: window light with the direction visible, low golden-hour sun raking across texture, or diffuse overcast from an identifiable side. Compose off-center with negative space and a rule-of-thirds anchor — the subject is NEVER dead center. One clear focal point per frame; the eye lands somewhere specific. Natural imperfection welcomed: dust on a beam, a slightly worn edge, uneven shadow falloff, one thing not quite in its place. Depth of field driven by real optics (50mm at f/2.8 or 90mm at f/4 look), not the flat plasticky bokeh AI models default to. Textures are honest — wood grain, weave in linen, pitting in cast iron, real skin. Square 1:1 framing. Hands, backs, silhouettes, and angled-away shots are fine and welcome; no clearly identifiable faces of real people; no on-image text or captions.

=== ADDITIONAL REJECTS ===

Do NOT produce: HDR-look processing, over-saturated color, plastic or over-smoothed textures, perfectly-symmetric composition, dead-center subject, stock-photo staging, artificially shallow depth of field with unnatural bokeh, 'teal-and-orange' cinematic grading, over-styled food arrangements, spurious food debris on non-food frames, glassy AI-perfect water, uniformly-graded atmospheric haze, mangled brand logos, or the flat generic AI-editorial plate look.`;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: {
    blockReason?: string;
  };
};

async function callGemini(
  apiKey: string,
  parts: Array<Record<string, unknown>>,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(GEMINI_ENDPOINT(GEMINI_MODEL, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`gemini image: HTTP ${response.status} — ${body.slice(0, 400)}`);
  }

  const data = (await response.json()) as GeminiResponse;
  if (data.promptFeedback?.blockReason) {
    throw new Error(`gemini image: blocked — ${data.promptFeedback.blockReason}`);
  }

  const outParts = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of outParts) {
    if (part.inlineData?.data) {
      const bytes = Uint8Array.from(Buffer.from(part.inlineData.data, "base64"));
      return { bytes, mimeType: part.inlineData.mimeType ?? "image/png" };
    }
  }
  throw new Error("gemini image: no inline image data in response");
}

async function generateOneImage(
  apiKey: string,
  slotPrompt: string,
  sectionTag: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const fullPrompt = `${sectionTag}\n\n${slotPrompt}${LATTE_IMAGE_STYLE_SUFFIX}`;
  return callGemini(apiKey, [{ text: fullPrompt }]);
}

/**
 * Reference-driven image generation for the theDrive slot.
 *
 * Two-stage pipeline:
 *
 * 1. Fetch a real press photo of the car via Wikipedia REST API (see
 *    saturday-latte-car-image.ts). Zero hallucination, correct year +
 *    generation.
 *
 * 2. Use Gemini in image-editing mode with EXTREME preservation
 *    constraints: the car pixels must not change, only the background
 *    may be replaced with the editorial scene from the writer's prompt.
 *    This gives us both accuracy (from the reference) and the newsletter's
 *    editorial tone (from the scene rewrite).
 *
 * If Wikipedia fails, falls through to text-only Gemini as a last resort
 * (known to produce wrong cars; only used if the primary path breaks).
 */
export async function generateDriveImageWithReference(
  apiKey: string,
  slotPrompt: string,
  sectionTag: string,
  carName: string,
): Promise<{ bytes: Uint8Array; mimeType: string; usedReference: boolean; referenceUrl?: string }> {
  let reference: Awaited<ReturnType<typeof fetchCarReferenceImage>> | null = null;
  try {
    reference = await fetchCarReferenceImage(carName);
  } catch (err) {
    console.error(
      "latte.car_reference_lookup_failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (reference) {
    console.info("latte.car_reference_hit", {
      car: carName,
      source_url: reference.sourceUrl,
    });

    // Try the strict background-only edit. If Gemini rejects it, fall
    // back to the reference photo used as-is (accurate car, generic
    // background) rather than text-only (unknown car).
    try {
      const edited = await editDriveImageBackground(
        apiKey,
        reference,
        slotPrompt,
        sectionTag,
        carName,
      );
      return {
        bytes: edited.bytes,
        mimeType: edited.mimeType,
        usedReference: true,
        referenceUrl: reference.sourceUrl,
      };
    } catch (err) {
      console.warn(
        "latte.car_edit_failed_using_reference_direct",
        err instanceof Error ? err.message : String(err),
      );
      return {
        bytes: reference.bytes,
        mimeType: reference.mimeType,
        usedReference: true,
        referenceUrl: reference.sourceUrl,
      };
    }
  }

  console.warn("latte.car_falling_back_to_text_only_gemini", { car: carName });
  const fallback = await generateOneImage(apiKey, slotPrompt, sectionTag);
  return { ...fallback, usedReference: false };
}

/**
 * Background-only edit of a car reference photo. The reference image
 * shows the car (as it left the factory) against some incidental
 * background — a dealership, a street, a driveway. We want the CAR to
 * remain pixel-faithful and the BACKGROUND to become the editorial
 * scene the writer described.
 *
 * The prompt aggressively constrains Gemini against modifying the car
 * because prior attempts saw Gemini strip performance-variant styling
 * (fender flares, quad exhausts, aero) or drift to the wrong generation.
 */
export async function editDriveImageBackground(
  apiKey: string,
  reference: { bytes: Uint8Array; mimeType: string; sourceUrl: string; searchQuery: string },
  slotPrompt: string,
  sectionTag: string,
  carName: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const instruction = `${sectionTag}

=== BACKGROUND-ONLY EDIT (car must not change) ===

The image below is a reference photograph of "${carName}". This car — every pixel of the car body, wheels, headlights, tail lights, grille, badging, ride height, color, and factory-spec styling — must appear in the output image IDENTICAL to how it appears in the reference. Do not stylize the car. Do not remove details. Do not add details. Do not change the color. Do not change the wheel design. Do not modify the front fascia. Do not modify the fender width or flare geometry. Do not modify the exhaust arrangement. The car is a fixed subject that MUST be preserved.

You may ONLY change the BACKGROUND and the LIGHT on the car (as would happen if the same car were photographed at a different location and time of day). Specifically:
- Replace the current background scene entirely with the editorial setting described below.
- Adjust the lighting on the car to match the direction and quality of light in the new scene (a car in golden-hour side light will have that light on its side; a car in overcast morning light will have flat diffuse light on its body). But do not change the car's color or add reflections that would obscure its bodywork detail.
- Reframe the composition if needed — off-center, rule-of-thirds, negative space on one side — but ALWAYS with the same car intact.
- Ground the car realistically in the new scene: the surface it sits on (asphalt, wet coastal road, gravel, cobblestone), a shadow beneath it consistent with the light source, and appropriate weather (dry, wet, fog, mist).

You may NOT:
- Change any aspect of the car itself (body, wheels, lights, grille, badges, ride height, color).
- Add aftermarket-looking modifications (bigger wheels, lowered stance, wider fenders, aftermarket exhaust).
- Add or remove performance styling elements from the car.
- Reshape the car body from a different generation or trim.
- Add close-up details of the car's badge that would require rendering the logo up close (keep the badge at the same distance as in the reference).

=== EDITORIAL SETTING ===

${slotPrompt}${LATTE_IMAGE_STYLE_SUFFIX}

REMINDER: the CAR itself is fixed to the reference. Only the BACKGROUND and LIGHT may change. Preserve the car exactly.`;

  const base64 = Buffer.from(reference.bytes).toString("base64");
  return callGemini(apiKey, [
    { text: instruction },
    { inlineData: { mimeType: reference.mimeType, data: base64 } },
  ]);
}

async function uploadToStorage(
  storage: SupabaseClient,
  bytes: Uint8Array,
  storagePath: string,
  mimeType: string,
): Promise<string> {
  const { error: uploadErr } = await storage.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType,
      upsert: true,
    });
  if (uploadErr) throw new Error(`storage upload: ${uploadErr.message}`);

  const { data: publicData } = storage.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  if (!publicData?.publicUrl) throw new Error("storage: missing publicUrl");
  return publicData.publicUrl;
}

function extForMime(mimeType: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

async function generateAndStore(
  apiKey: string,
  storage: SupabaseClient,
  slot: string,
  prompt: string,
  sectionTag: string,
  subjects: LatteImageSubjects,
  issueDate: string,
  genStamp: string,
): Promise<{ url: string; usedReference?: boolean; referenceUrl?: string }> {
  let img: { bytes: Uint8Array; mimeType: string; usedReference?: boolean; referenceUrl?: string };
  if (slot === "the-drive" && subjects.theDriveCar.trim() !== "") {
    img = await generateDriveImageWithReference(apiKey, prompt, sectionTag, subjects.theDriveCar);
  } else {
    const result = await generateOneImage(apiKey, prompt, sectionTag);
    img = result;
  }
  const filename = `${issueDate}/${slot}-${genStamp}.${extForMime(img.mimeType)}`;
  const publicUrl = await uploadToStorage(storage, img.bytes, filename, img.mimeType);
  return {
    url: publicUrl,
    ...(img.usedReference !== undefined ? { usedReference: img.usedReference } : {}),
    ...(img.referenceUrl ? { referenceUrl: img.referenceUrl } : {}),
  };
}

// Build the section+subject tag prepended to every prompt sent to Gemini.
// The tag names the newsletter section and the specific subject the image
// must render, locking the slot even if the writer's prompt drifted.
function sectionTagFor(slot: string, subjects: LatteImageSubjects): string {
  const parts: string[] = [];
  switch (slot) {
    case "hero":
      parts.push(
        `[Saturday Morning Latte — Cover Story HERO image] Subject: the town or place named "${subjects.coverStoryLocation}". This image is the top banner under the Cover Story headline; it must clearly show this specific location.`,
      );
      break;
    case "cover-detail":
      parts.push(
        `[Saturday Morning Latte — Cover Story DETAIL image] Subject: one specific detail from "${subjects.coverStoryLocation}". This image sits mid-way through the Cover Story body; it must depict a physical detail of that specific place, not a generic version.`,
      );
      break;
    case "tasting-1":
      parts.push(
        `[Saturday Morning Latte — Tasting Menu #1 image] Subject: "${subjects.tastingMenuTitles[0] ?? ""}". This image sits under the first tasting menu item; it MUST render THIS EXACT product, book, film, or drink, not a similar-category alternative. Two tasting menu items in this issue may look alike (both books, both coffee-adjacent, etc.); this image must be unambiguously about the specific item named.`,
      );
      break;
    case "tasting-2":
      parts.push(
        `[Saturday Morning Latte — Tasting Menu #2 image] Subject: "${subjects.tastingMenuTitles[1] ?? ""}". This image sits under the second tasting menu item; it MUST render THIS EXACT product, book, film, or drink, not a similar-category alternative. Two tasting menu items in this issue may look alike; this image must be unambiguously about the specific item named.`,
      );
      break;
    case "tasting-3":
      parts.push(
        `[Saturday Morning Latte — Tasting Menu #3 image] Subject: "${subjects.tastingMenuTitles[2] ?? ""}". This image sits under the third tasting menu item; it MUST render THIS EXACT product, book, film, or drink, not a similar-category alternative. Two tasting menu items in this issue may look alike; this image must be unambiguously about the specific item named.`,
      );
      break;
    case "hosts-corner":
      parts.push(
        `[Saturday Morning Latte — Host's Corner image] Subject: the cooking technique "${subjects.hostsCornerMove}". This image sits inside the Host's Corner section; it must depict THIS specific technique in progress or its result, not a generic kitchen scene.`,
      );
      break;
    case "the-drive":
      parts.push(
        `[Saturday Morning Latte — The Drive image] Subject: the car "${subjects.theDriveCar}". This image sits inside The Drive section; it must render THIS EXACT car, correct year and generation, not a different generation of the same nameplate.`,
      );
      break;
  }
  return parts.join("\n");
}

// Short random suffix appended to every image filename so regenerating
// the same issueDate produces distinct public URLs. Prevents CDN cache
// staleness from serving the previous run's images.
function makeGenStamp(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function generateLatteImages(opts: {
  prompts: LatteImagePrompts;
  subjects: LatteImageSubjects;
  issueDate: string;
  googleApiKey?: string;
}): Promise<ImageGenResult> {
  const start = Date.now();
  const apiKey = opts.googleApiKey ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("latte-images: GOOGLE_API_KEY missing");

  const storage = getStorageClient();
  const urls: LatteImageUrls = {};
  const failures: Array<{ slot: string; error: string }> = [];
  const genStamp = makeGenStamp();

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

  // Fire all 7 in parallel — Gemini is fast and tolerates concurrent requests
  const results = await Promise.allSettled(
    jobs.map((job) =>
      job.prompt.trim() === ""
        ? Promise.reject(new Error("empty prompt"))
        : generateAndStore(
            apiKey,
            storage,
            job.slot,
            job.prompt,
            sectionTagFor(job.slot, opts.subjects),
            opts.subjects,
            opts.issueDate,
            genStamp,
          ),
    ),
  );

  let successCount = 0;
  let driveReferenceUrl: string | null = null;
  let driveUsedReference = false;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    const res = results[i]!;
    if (res.status === "fulfilled") {
      job.set(res.value.url);
      successCount++;
      if (job.slot === "the-drive") {
        driveReferenceUrl = res.value.referenceUrl ?? null;
        driveUsedReference = res.value.usedReference ?? false;
      }
    } else {
      failures.push({
        slot: job.slot,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  }

  return {
    urls,
    costUsd: successCount * COST_PER_IMAGE,
    latencyMs: Date.now() - start,
    failures,
    driveReferenceUrl,
    driveUsedReference,
  };
}
