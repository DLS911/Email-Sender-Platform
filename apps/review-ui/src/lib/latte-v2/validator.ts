/**
 * v2 scoring validator. Every candidate is scored 0-100; threshold 70.
 * Rules that were negatives in v1's LATTE_IMAGE_STYLE_SUFFIX now live
 * here as named deductions.
 *
 * MVP: Haiku vision call returns a JSON deduction list. Deterministic
 * text-detection (OCR) + aspect check happens locally BEFORE Haiku.
 * CLIP/DINO identity checks (spec §4.7) are stubbed for MVP — real
 * implementation lands with the composite route.
 */

import Anthropic from "@anthropic-ai/sdk";

const VALIDATOR_MODEL = "claude-haiku-4-5-20251001";

export type V2Slot =
  | "hero"
  | "coverDetail"
  | "hostsCorner"
  | "theDrive"
  | "tastingMenu-book"
  | "tastingMenu-film-poster"
  | "tastingMenu-film-keyframe"
  | "tastingMenu-product"
  | "tastingMenu-drink";

export type V2ValidatorContext = {
  slot: V2Slot;
  subject: string;
  /** Extra facts from research so the validator can score "landmark present" etc. */
  visualFacts?: {
    landmarks?: string[];
    signatureSubject?: string;
    cookware?: string;
    generationCode?: string;
    features?: string[];
  };
};

export type V2Verdict = {
  score: number;
  deductions: Array<{ code: string; weight: number; note: string }>;
  raw: string;
};

const DEDUCTION_WEIGHTS: Record<string, number> = {
  text_in_frame: -40,
  incoherent_structure: -25,
  floating_object: -30,
  pair_count_wrong: -15,
  crowd_when_forbidden: -40,
  landmark_missing: -40,
  signature_subject_missing: -40,
  cookware_type_wrong: -30,
  cookware_on_wood: -25,
  steam_from_closed_lid: -25,
  utensil_wrong: -15,
  hands_in_food: -30,
  probe_in_food: -20,
  spill_puddle: -20,
  incoherent_light_direction: -20,
  ai_plastic_texture: -20,
  hdr_look: -15,
  dead_center_composition: -10,
  glassy_water: -15,
  uniform_haze: -15,
  screen_device_in_keyframe: -50,
  viewer_in_keyframe: -30,
  poster_on_screen: -40,
  poster_on_incoherent_wall: -25,
  wrong_car_generation: -30,
  motion_blur_when_static: -25,
  two_cars_in_frame: -30,
  fisheye_perspective: -20,
  boring_object_scene: -25,
  street_food_generic_scene: -30,
  tight_object_when_scenic_expected: -25,
  legibility_too_dark: -30,
};

function slotChecklist(ctx: V2ValidatorContext): string {
  const facts = ctx.visualFacts ?? {};
  const commonChecklist = `Deduction codes to consider:
- text_in_frame: any text / lettering / caption / watermark / logo / signage in the frame
- incoherent_structure: bridge with a dead end, road terminating in nothing, pier floating, wall stopping mid-air
- floating_object: any object without visible support / shadow contact
- pair_count_wrong: 3 boots / 3 gloves / anything that comes in 2s but shows a wrong count
- incoherent_light_direction: multiple contradictory shadow directions
- ai_plastic_texture: over-smoothed skin/wood/metal that reads as AI
- hdr_look: over-saturated / crushed / halo-tone-mapped
- dead_center_composition: subject dead-centre, no rule-of-thirds
- glassy_water: any water surface rendered as a smooth mirror gradient
- uniform_haze: fog/mist as a uniform gray gradient with no structure`;

  switch (ctx.slot) {
    case "hero":
      return `Slot: HERO for cover story "${ctx.subject}".
${facts.landmarks && facts.landmarks.length > 0 ? `Expected landmarks (one must be recognisable in the frame): ${facts.landmarks.map((l) => l.split(":")[0]).join(", ")}.` : ""}
Slot-specific deductions:
- landmark_missing: no recognisable named landmark from ${ctx.subject}
- crowd_when_forbidden: 3+ people all facing camera / busy plaza / packed sidewalk (single distant figure ok)

${commonChecklist}`;
    case "coverDetail":
      return `Slot: COVER DETAIL for cover story "${ctx.subject}". This is the SECOND scenic shot (companion to hero, different angle or subject, both scenic).
${facts.signatureSubject ? `Signature subject that MUST appear in the frame: ${facts.signatureSubject}.` : ""}
Slot-specific deductions:
- signature_subject_missing: ${facts.signatureSubject ? `no ${facts.signatureSubject} visible in the frame` : "(not applicable this issue)"}
- tight_object_when_scenic_expected: a close-up of a doorknob / window latch / mailbox / bare sign / single object detail
- boring_object_scene: plain object on plain surface with no rich texture, evocative light, or activity
- street_food_generic_scene: street food stand / stall / crowded market

${commonChecklist}`;
    case "hostsCorner":
      return `Slot: HOST'S CORNER for technique "${ctx.subject}".
${facts.cookware ? `Expected cookware type: ${facts.cookware}.` : ""}
Slot-specific deductions:
- cookware_type_wrong: rendered cookware is a different type than ${facts.cookware ?? "the researched type"} (wok vs saute pan vs cast iron vs dutch oven)
- cookware_on_wood: hot pan directly on bare wood without a trivet
- steam_from_closed_lid: steam venting from a closed lid on a kettle / dutch oven / any covered vessel
- utensil_wrong: wooden spoon in an egg pan, metal spatula in a nonstick, wrong utensil for the technique
- hands_in_food: any hand / arm / silhouette in the food frame
- probe_in_food: thermometer / probe stuck in the food (allowed only if the move title explicitly names temperature)
- spill_puddle: puddle of liquid / grease / sauce on the counter or table adjacent to the pan
- floating_object: food or pan floating without visible surface contact

${commonChecklist}`;
    case "theDrive":
      return `Slot: THE DRIVE for car "${ctx.subject}".
${facts.generationCode ? `Expected generation: ${facts.generationCode}.` : ""}
${facts.features && facts.features.length > 0 ? `Expected distinguishing features: ${facts.features.slice(0, 3).map((f) => f.split("—")[0]).join("; ")}.` : ""}
Slot-specific deductions:
- wrong_car_generation: rendered car is a previous or different generation than ${facts.generationCode ?? "the correct one"}
- motion_blur_when_static: blurred wheels or streaking road on a car in a static parked pose
- two_cars_in_frame: any second car visible (including background / mirror / trailer)
- fisheye_perspective: stretched nose or wide-angle-warped body from a distorting lens

${commonChecklist}`;
    case "tastingMenu-book":
      return `Slot: TASTING (BOOK) for "${ctx.subject}".
Slot-specific deductions:
- landmark_missing: book cover typography doesn't match "${ctx.subject}" (or is garbled)
- boring_object_scene: nothing but a bare cover on white (no wood, no light, no scene)

${commonChecklist}`;
    case "tastingMenu-film-poster":
      return `Slot: TASTING (FILM POSTER) for "${ctx.subject}".
Slot-specific deductions:
- poster_on_screen: poster shown on a TV / laptop / tablet / phone screen
- poster_on_incoherent_wall: poster on a half-wall, free-floating wall segment, or wall with impossible cutouts

${commonChecklist}`;
    case "tastingMenu-film-keyframe":
      return `Slot: TASTING (FILM KEYFRAME) for "${ctx.subject}".
Slot-specific deductions:
- screen_device_in_keyframe: any TV / laptop / tablet / phone / monitor visible in the frame
- viewer_in_keyframe: any person who isn't an actor in the film performing in-character
- legibility_too_dark: image renders as mostly black / crushed shadows / illegible at 600px thumbnail

${commonChecklist}`;
    case "tastingMenu-product":
      return `Slot: TASTING (PRODUCT) for "${ctx.subject}".
Slot-specific deductions:
- boring_object_scene: white catalog background with no editorial scene at all
- floating_object: product hovers with no visible surface contact
- text_in_frame: watermark / retailer stamp / URL overlay still visible

${commonChecklist}`;
    case "tastingMenu-drink":
      return `Slot: TASTING (DRINK) for "${ctx.subject}".
Slot-specific deductions:
- boring_object_scene: white catalog background with no editorial scene at all
- floating_object: bottle floats with no visible surface contact
- text_in_frame: watermark / retailer stamp / URL overlay still visible

${commonChecklist}`;
  }
}

/**
 * Local text-detection guard. Uses no OCR (would require tesseract);
 * instead relies on Haiku's text_in_frame deduction. Returns any
 * automatic pre-deductions before the Haiku call.
 */
function preDeduct(_bytes: Uint8Array, _mimeType: string): Array<{ code: string; weight: number; note: string }> {
  // MVP: no local pre-deductions. Aspect check + OCR pass would go here
  // per spec §6.1 but require extra deps; deferred to a later iteration.
  return [];
}

export async function scoreCandidate(
  bytes: Uint8Array,
  mimeType: string,
  ctx: V2ValidatorContext,
): Promise<V2Verdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const pre = preDeduct(bytes, mimeType);
  if (!apiKey) {
    return { score: 50, deductions: pre, raw: "no ANTHROPIC_API_KEY; scored 50 (neutral)" };
  }
  const checklist = slotChecklist(ctx);
  try {
    const client = new Anthropic({ apiKey });
    const b64 = Buffer.from(bytes).toString("base64");
    const imageMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    const response = await client.messages.create({
      model: VALIDATOR_MODEL,
      max_tokens: 800,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are the v2 image validator. You score a candidate image by listing named deductions (never boolean pass/fail). Only use deduction codes from the checklist. Return strict JSON:

{"deductions": [{"code": "<code>", "note": "<one short observation>"}]}

If nothing is wrong, return {"deductions": []}. Do not invent new codes.

${checklist}`,
            },
            {
              type: "image",
              source: {
                type: "base64",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                media_type: imageMime as any,
                data: b64,
              },
            },
          ],
        },
      ],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    const stripped = text.replace(/```json\s*|\s*```/g, "").trim();
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first === -1 || last === -1) {
      return { score: 50, deductions: pre, raw: "validator returned no JSON" };
    }
    const parsed = JSON.parse(stripped.slice(first, last + 1)) as { deductions?: Array<{ code?: string; note?: string }> };
    const modelDeductions = (parsed.deductions ?? [])
      .filter((d): d is { code: string; note?: string } => typeof d?.code === "string" && d.code in DEDUCTION_WEIGHTS)
      .map((d) => ({ code: d.code, weight: DEDUCTION_WEIGHTS[d.code] ?? 0, note: d.note ?? "" }));
    const all = [...pre, ...modelDeductions];
    const totalDeduction = all.reduce((s, d) => s + d.weight, 0);
    const score = Math.max(0, Math.min(100, 100 + totalDeduction));
    return { score, deductions: all, raw: text.slice(0, 400) };
  } catch (err) {
    console.warn("latte-v2.validator_threw", err instanceof Error ? err.message : String(err));
    return { score: 50, deductions: pre, raw: `validator threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}
