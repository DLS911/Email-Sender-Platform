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
import Anthropic from "@anthropic-ai/sdk";
import { fetchCarReferenceImage } from "./saturday-latte-car-image";
import {
  type ImageValidatorContext,
  type ImageValidatorVerdict,
  validateImage,
} from "./saturday-latte-image-validator";
import { fetchSubjectReferenceImage } from "./saturday-latte-subject-reference";

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
  tastingMenuLabels?: string[]; // 3 labels (e.g., "Worth Watching") - used to derive validator kind
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
  /** Per-slot validator verdicts (attempts, whether validator passed, final reason). Populated for every slot when the validator is enabled. */
  validatorVerdicts?: Array<{
    slot: string;
    attempts: number;
    passed: boolean;
    finalReason?: string;
    usedFallbackToReference?: boolean;
  }>;
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

**THIS RULE EXTENDS TO "SEEMINGLY RELEVANT" DEBRIS.** A single coffee bean sitting on the counter next to an espresso machine is NOT allowed — it's still spurious debris even if it's category-adjacent to the product. A single tea leaf near a teapot is NOT allowed. A single grain of salt near a knife is NOT allowed. Products live cleanly on their surface; do NOT add a "flavor cue" object as decoration. The espresso machine is the subject, not the espresso machine PLUS a random bean. The knife is the subject, not the knife PLUS a stray herb sprig. Show the product cleanly.

**BOOK IMAGES: NO DECORATIVE BOTANICALS OR SEASONAL DEBRIS.** When the frame is a book, DO NOT place any of the following on top of, next to, or near the book: a single leaf (fall/autumn leaf, green leaf, pressed leaf), flower petals, dried flowers, sprigs of eucalyptus or rosemary or lavender, pinecones, seeds, acorns, feathers, pressed botanicals of any kind, moss, or any other "aesthetic reading nook" decoration. A book on a table is: the book, alone, on the table (or with a companion object like a coffee cup, a pair of glasses, a bookmark peeking out, a pen). NOT the book with a fall leaf placed on the cover. NOT the book with a rose petal beside it. NOT the book with a rosemary sprig for flavor. Real editorial book photography shows the book cleanly — its typography and cover art are the composition, not a Pinterest botanical accent.

**REALISTIC QUANTITIES OF OBJECTS THAT COME IN SETS.** When depicting furniture, tableware, or environmental objects that would realistically appear in a set, show a realistic count for the scene — not a single lonely instance and not empty space where multiple should be:
- Bars have multiple stools, not one lonely stool. Show 3-6 stools at a bar.
- Restaurants have multiple tables and chairs, not one solo table. Show a real seating layout.
- Kitchens have multiple utensils / cookware / spice jars, not one solo item.
- Dining rooms have multiple chairs at the table, not one.
- Retail shelves have multiple items on them.
- Book shelves have multiple books, not one.
- Public benches typically appear in a small run, not solo.
The "one lonely stool at a bar" or "one lonely chair in a restaurant" is a strong AI-fabrication tell. Depict what would realistically be there in realistic multiples.

**NO GLASSY / UNIFORM WATER.** Real water surfaces have wind-driven ripple texture, directional wave patterns, subtle color variation from depth and reflection, and imperfect reflections. Do NOT render water as a smooth glass-mirror gradient. Bays, harbors, lakes, and oceans should show visible surface texture — small waves, wind lanes, real reflections that break at wave crests, not a flat AI-perfect reflection.
- **Specifically for open water in landscape shots (Great Lakes, ocean bays, harbors):** the surface must show visible micro-chop — thousands of small facets catching light at different angles, wind fetch lanes running in one direction, darker patches where clouds shadow the water, brighter patches where sun hits, and a subtle color gradient from deeper (darker teal/navy) offshore to shallower (lighter green/gray) toward shore. NO uniform slate-gray or uniform teal wash. NO reflection of the sky that's cleaner and sharper than the sky itself. NO "flat matte painting of water" look.
- **Water-reflection specifics:** if a lighthouse, boat, or shoreline structure reflects on the water, the reflection is BROKEN into thousands of pieces by chop — never a mirror-clean mirror. Vertical elements (mast, tower) show as vertical streaks of reflected color that jiggle and interrupt, not as a clean flipped copy.

**NO UNIFORM ATMOSPHERIC HAZE.** Fog, mist, and morning atmosphere have STRUCTURE — banks that hang over the water in bands, patches that break around trees or buildings, directional layers. Do NOT render fog as a smooth gray gradient that fades uniformly from foreground to background. If the frame has atmosphere, it must have shape and directionality — you should be able to say "the fog is heavier over the water on the right side" or "the mist is clearing over the harbor as the sun comes up."
- **Fog physicality:** real fog is water vapor made of billions of small droplets. Under real light it has TONAL BREAKS — brighter where sun hits from behind, darker where shadowed by a landmass or a cloud. It reveals its edges against dark backgrounds (a fog bank has a visible top edge against a treeline or hillside). Distant objects don't just fade to a soft matte gray — they show progressive contrast falloff (a boat 400m out shows silhouette + faint hull markings; a shoreline 1km out shows only silhouette; the horizon vanishes entirely). NO uniform bluish-gray wash over the whole frame. NO "beautifully misty" airbrush effect. NO fog that has no visible top edge or lower boundary.
- **Fog interacts with light in specific ways:** morning fog at dawn is warm-tinted where sun hits and cool-blue in the shadows — NOT one flat "atmospheric" color. Fog burns off from the top down as sun heats it, so a fog bank often has a lower dense layer and a thinning upper layer with visible sky above.

**COASTAL / LAKESIDE / HARBOR LIGHTING SPECIFICS (for hero shots of lighthouses, waterfronts, docks, coves).**
- Real coastal light in the morning is DIRECTIONAL — you can point at the sun's rough position from the shadows in the frame. NO "ambient soft magic" light that has no source.
- Contrast is REAL: bright side of the lighthouse is 3-4 stops brighter than the shaded side. Water in direct sun is much brighter than water in shadow. Sand or rocks show real specular highlights on wet edges.
- Sky color IS what determines water color in flat light. If it's overcast, water is the color of the overcast sky (slate/pewter). If clear, water shows both sky reflection AND the true water color where wind chop breaks the reflection.
- NO teal-and-orange gradient sunrise. NO magenta-and-purple sunrise. Real dawn on the Great Lakes is a subtle pearl-gray-to-warm-peach transition, and the peach only lives near the horizon on the sun's side of the frame.
- Coastal atmosphere at dawn: often crisp and cold, NOT the AI "soft dreamy uniform bloom." If mist is present, it's LOW over the water (see fog rules above), not everywhere.

**NO SCUFFED OR MANGLED BRAND LOGOS.** If a brand logo would appear in the frame (car badging, product labels), either (a) render it correctly and legibly, or (b) shoot the frame from an angle where the logo is not visible or is small enough to be indistinct. Never render a garbled / half-formed / smudged version of a real logo. If in doubt, choose the angle that hides the badging.

**GEOGRAPHIC ACCURACY (for location shots like Cover Story hero, cover detail).** Do NOT invent proximity between features that would not exist in the real place. If the Cover Story is Burlington VT, the downtown brick storefronts are NOT immediately adjacent to Lake Champlain — there are streets, a waterfront park, and open ground between them. If the writer's prompt describes a compressed relationship between features that isn't geographically real, render the frame HONESTLY with only ONE feature at a time (a downtown street scene, OR a lake shoreline scene, but not both compressed together in a way that misrepresents the actual layout). When in doubt, show LESS in a single frame — a single street corner, a single waterfront view, a single park bench — rather than trying to combine unrelated features into one impossible composition.

**FOOD IMAGES: NO HANDS, NO HUMANS.** Any frame showing food (Host's Corner cooking scenes, plated dishes, food-related Tasting Menu items) must NOT include hands, arms, silhouettes of people, spatulas being held, forks mid-cut, or any human-food interaction. Show the food ALONE — finished dish on a plate, whole pie on a rack, pan on the stove, cutting board with prepped ingredients, jar of pickles on a windowsill. The moment a hand or arm enters a food frame, Gemini gets the proportions wrong (a slice that's too big for what remains, fingers on food that look off, spatula geometry that's impossible). Cleanest solution: no humans in food frames, ever.

**PHYSICS MUST BE REAL.** The image must obey basic physics of the objects in it.
- **NO SELF-ACTUATING OBJECTS. NO INVISIBLE-HAND OPERATIONS. THIS IS ABSOLUTE.** Products do not operate themselves. A kettle does NOT tilt and pour itself into a filter — it is either upright on a stove/trivet, OR being held by a person in the frame, OR the frame shows a filter with already-poured water (kettle off-frame). A grinder does NOT grind by itself — it sits at rest on the counter. A coffee maker does NOT drip by itself into a carafe unless it's an automatic machine plugged in and RUNNING (with the pot in place and the machine visibly powered on). A tap does NOT run water into a sink with nobody nearby. A jar does NOT pour its contents onto a plate. If the object is depicted mid-action without a human agent, that is an AUTOMATIC FAIL — the correct render is the object AT REST. When in doubt: still-life the product, do not animate it.
- **PRODUCTS SIT ON SURFACES. NO FLOATING.** Every physical object in the frame must be gravitationally supported — sitting on a counter, table, shelf, stove, or held by a visible hand. An OXO brew grinder is NOT hovering above the counter with the pour-spout tilted mid-air. A kettle is NOT suspended mid-pour with no hand on the handle. If the composition would require the object to hover, RESET the pose so the object rests on a surface in a static, unpretentious way.
- **Steam only escapes from open apertures. THIS IS ABSOLUTE.** A kettle with the lid CLOSED does not vent steam from the top of the lid, from under the lid seam, from the sides of the kettle body, or from anywhere except the open spout. Steam CAN come from: the open spout of a kettle in use, a lid that is visibly ajar or removed, a pot with no lid, an open cup of hot liquid, actively boiling water in an uncovered vessel, hot food on a plate, freshly poured hot liquid landing in another vessel. Steam CANNOT come from: the top of a closed kettle lid, the top of a closed pot lid, the sides of a sealed vessel, an inert dry object.
- **Pour-over kettle specific (gooseneck kettles, Fellow Stagg, Hario Buono, etc.):** these have a closed lid and a narrow gooseneck spout. **Since no hand is in these frames (no-hands rule), the kettle must be UPRIGHT AND AT REST — sitting on the stove, on a trivet, or on the counter. NOT tilted mid-pour with no one holding it.** If you want to depict pour-over, show the filter/carafe with water already in the coffee bed and the kettle sitting nearby off-heat, OR show only the finished pour-over cup with steam rising, kettle off-frame. Do NOT render a floating tilted kettle pouring itself. Steam does NOT plume from the top of the closed lid. If the kettle is off-heat sitting next to a V60, there should be minimal or no visible steam at all.
- **Shadows fall in the direction the primary light source dictates.** If sun is coming from camera-right, shadows fall to the left. Never have contradictory shadow directions in the same frame.
- **Reflections match the camera viewpoint.** A polished surface reflects what would actually be in front of it from the camera's angle, not a random scene.
- **Liquids sit level in vessels regardless of vessel tilt** (Earth gravity). A tilted cup shows liquid at a level angle, not tilted with the cup.
- **Hot pans show heat effects appropriately.** Steam only from wet food or actively boiling water; not from a dry cast iron with a raw steak just placed on it.
- **Fabric drapes with weight and gravity.** Linen falls in soft folds toward the floor, not defying gravity.

**KITCHEN LOGIC (for Host's Corner and any food frame).**
- **The kitchen must be spatially coherent.** Perspective is consistent throughout the frame — one horizon line, one vanishing direction, no impossible corners. Appliances go where they'd logically live: stove abuts a countertop, fridge stands upright against a wall, cabinets align to walls not to nothing, sink has plumbing under it, backsplash meets counter cleanly. NO floating cabinets. NO wall segments that terminate in mid-air. NO stove positioned in the middle of the room with no counter. NO fridge that faces sideways relative to the countertops. If you can't render a coherent kitchen, tighten the framing to just the pan-on-stove or the plated-dish-on-counter — a coherent tight frame beats an ambitious wide shot with impossible geometry.
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

Shoot in the style of Garden & Gun, Kinfolk, or National Geographic Traveler — real editorial photography by a photographer with taste. Medium-format film aesthetic: Portra 400 warmth for humans, interiors, and food; Ektar 100 for landscape. Colors feel lived-in, not filtered — warm skin tones, natural greens, honest blues. Motivated light with specific character: window light with the direction visible, low golden-hour sun raking across texture, or diffuse overcast from an identifiable side. Compose off-center with negative space and a rule-of-thirds anchor — the subject is NEVER dead center. One clear focal point per frame; the eye lands somewhere specific. Natural imperfection welcomed: dust on a beam, a slightly worn edge, uneven shadow falloff, one thing not quite in its place. Depth of field driven by real optics (50mm at f/2.8 or 90mm at f/4 look), not the flat plasticky bokeh AI models default to. Textures are honest — wood grain, weave in linen, pitting in cast iron, real skin. Square 1:1 framing. Hands, backs, silhouettes, and angled-away shots are fine and welcome; no clearly identifiable faces of real people.

**ABSOLUTELY NO TEXT, LETTERS, CAPTIONS, HEADERS, WATERMARKS, OR TITLES anywhere in the image frame.** This is a critical rule Gemini repeatedly violates by adding location-name banners across the top of hero images (e.g., garbled attempts at "GREENVILLE" or "MARFA" or the place name). Do NOT add ANY of the following:
- Location-name headers at the top of the frame ("EANA URMIEL"-style garbled place names)
- Caption text below the image
- Faux-magazine cover text or titles
- Watermarks, signatures, "artist name" text
- Made-up letterforms designed to look like text
- Decorative title-treatment overlays
- The name of the destination or subject spelled out anywhere in the frame

Real signage that would naturally appear IN the scene (a "STOP" sign, a shop's actual name on its storefront visible from the street, a legible book cover title, a road sign) is fine — but only if it's real signage in the world of the photograph, not decorative text laid on top of the image. If real text is in the scene, it must render legibly and correctly at its actual location — never garbled.

=== ADDITIONAL REJECTS ===

Do NOT produce: HDR-look processing, over-saturated color, plastic or over-smoothed textures, perfectly-symmetric composition, dead-center subject, stock-photo staging, artificially shallow depth of field with unnatural bokeh, 'teal-and-orange' cinematic grading, over-styled food arrangements, spurious food debris on non-food frames, glassy AI-perfect water, uniformly-graded atmospheric haze, "beautiful dreamy soft mist" airbrush effect, sourceless ambient soft magic light, uniform slate-gray water wash, mirror-perfect reflections on open water, sunrise gradients that go from teal to magenta, mangled brand logos, or the flat generic AI-editorial plate look.`;

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
    // Pass the writer's slotPrompt as sceneIntent so the vision picker
    // can select a reference pose that matches the target shot (side
    // profile for panning, 3/4 for static, rear-quarter for garage etc)
    reference = await fetchCarReferenceImage(carName, slotPrompt);
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

**NO ERA-MIXING (this is critical).** Do NOT create a Frankenstein car that combines a modern face with an older body, or older headlights on a newer body. Every visible part of the car in the output MUST belong to the SAME year/generation as the reference. If the reference is a 2024 Mustang, every element (front fascia, headlights, taillights, wheels, hood details, side vents, mirrors) must be from the 2024-generation Mustang - NOT a 2019 body with the 2024 face grafted on, and NOT a 2024 body with the 2019 lights. The reference photo shows one specific model-year and generation; preserve THAT whole car, not a hybrid of multiple eras. If unsure whether a specific styling detail belongs to the reference's generation, err on the side of exactly matching what the reference photo shows pixel-for-pixel rather than inventing.

**OUTPUT ASPECT RATIO: 1:1 SQUARE.** The final image must be a square (1:1 aspect ratio) that fits into a newsletter's square image slot. Compose the frame so the car sits inside a square canvas with editorial-appropriate negative space above/below/beside it. Do NOT produce a wide rectangular image — the template will crop it awkwardly. If the reference car is elongated (long sedan), zoom in slightly and lose small amounts of the car's extreme ends rather than delivering a rectangular output. Off-center rule-of-thirds composition within the square frame is preferred.

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

/**
 * Ask Haiku to describe the specific visual signature of a film. Fed
 * into the keyframe generation prompt so Gemini can produce a still
 * that mimics the film's ACTUAL cinematography, not the generic AI
 * "golden hour hero shot" default.
 *
 * Returns a compact profile: director + cinematographer, color palette,
 * framing conventions, camera format, distinctive visual habits. Kept
 * to ~150 words so the Gemini prompt doesn't get too long.
 *
 * Returns null on failure (no film-style info baked into the prompt;
 * falls back to poster mode).
 */
/**
 * Ask Haiku to describe the specific visual characteristics of a
 * named landmark or iconic location. Fed into the hero image prompt
 * so Gemini renders the landmark's actual geometry, not a generic
 * approximation. Example: Chinati Foundation sculptures are hollow
 * rectangular concrete forms in specific rows across a mesa - not
 * solid brick shapes. Haiku returns the concrete visual details.
 *
 * Returns ~120 words of specific visual description, or null if
 * Haiku doesn't know the landmark well enough (writer prompt falls
 * back to generic hero prompt).
 */
export async function researchLandmarkVisualDetail(location: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0.2,
      system: `You describe the specific visual characteristics of a named landmark, iconic feature, or unique place. The description will be fed to an image generation model to help it render the landmark accurately, not a generic version.

Focus on what makes THIS landmark look different from other similar places:
- Specific geometry, shape, dimensions, and structure (a Chinati concrete piece is a HOLLOW rectangular form ~2.5m tall in rows across a mesa, not a solid brick)
- Materials and textures (rough concrete, weathered adobe, painted metal, unpainted steel)
- Color palette (the ochre of adobe, the grey of raw concrete, the rust of Corten steel)
- Setting and surroundings (isolated on a desert plain, tucked into a hillside, at the end of a pier)
- Distinguishing details visible at editorial-photo scale (specific proportions, patterns, arrangement)
- Any signature visual elements (a particular color of paint, a specific arrangement pattern, a specific weathering)

Return ~120 words of dense visual description. If you don't know the landmark well enough to describe it accurately, return the literal string "UNKNOWN" instead of guessing.`,
      messages: [
        {
          role: "user",
          content: `Describe the specific visual characteristics of this landmark or place: ${location}`,
        },
      ],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    text = text.trim();
    if (!text || text.toUpperCase() === "UNKNOWN" || text.length < 30) return null;
    return text;
  } catch (err) {
    console.warn(
      "latte.landmark_research_failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

export async function researchFilmVisualStyle(filmTitle: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0.2,
      system: `You describe the specific visual/cinematographic signature of a named film or TV series in a compact profile. The description will be fed to an image generation model to help it produce a keyframe that mimics THIS film's actual look — not a generic AI approximation.

Focus on what makes THIS film look different from other films:
- Director + cinematographer names (when notable)
- Color palette (warm ochres / muted blues / high-contrast B&W / saturated candy / earth tones / etc.)
- Framing conventions (symmetric center-framed / wide vistas with tiny figures / handheld intimate / static wide / etc.)
- Camera format (IMAX / anamorphic / 16mm grainy / digital clean)
- Lighting habits (naturalistic overcast / hard directional sun / practical warm sources / low-key noir)
- Any signature visual habits (Wes Anderson dollhouse symmetry / Villeneuve monumental scale / Fincher's cold precision / Malick's magic hour / Refn's neon)
- What the film REJECTS (not teal-and-orange, not shallow-focus if it's wide-and-deep, etc.)

Return ~150 words of dense, useful visual description. If you don't know the film well enough to describe it accurately, return the literal string "UNKNOWN" instead of guessing.`,
      messages: [
        {
          role: "user",
          content: `Describe the visual/cinematographic signature of: ${filmTitle}`,
        },
      ],
    });
    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    text = text.trim();
    if (!text || text.toUpperCase() === "UNKNOWN" || text.length < 30) return null;
    return text;
  } catch (err) {
    console.warn(
      "latte.film_style_research_failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function tastingKindFor(label?: string): "book" | "film" | "product" | "drink" | "unknown" {
  if (!label) return "unknown";
  const l = label.toLowerCase();
  if (l.includes("reading")) return "book";
  if (l.includes("watching")) return "film";
  if (l.includes("drinking")) return "drink";
  if (l.includes("trying")) return "product";
  if (l.includes("listening")) return "product";
  return "unknown";
}

function validatorContextFor(slot: string, subjects: LatteImageSubjects): ImageValidatorContext | null {
  switch (slot) {
    case "hero":
      return { slot: "hero", subject: subjects.coverStoryLocation };
    case "cover-detail":
      return { slot: "coverDetail", subject: subjects.coverStoryLocation };
    case "hosts-corner":
      return { slot: "hostsCorner", subject: subjects.hostsCornerMove };
    case "the-drive":
      return { slot: "theDrive", subject: subjects.theDriveCar };
    case "tasting-1":
      return {
        slot: "tastingMenu",
        subject: subjects.tastingMenuTitles[0] ?? "",
        tastingKind: tastingKindFor(subjects.tastingMenuLabels?.[0]),
      };
    case "tasting-2":
      return {
        slot: "tastingMenu",
        subject: subjects.tastingMenuTitles[1] ?? "",
        tastingKind: tastingKindFor(subjects.tastingMenuLabels?.[1]),
      };
    case "tasting-3":
      return {
        slot: "tastingMenu",
        subject: subjects.tastingMenuTitles[2] ?? "",
        tastingKind: tastingKindFor(subjects.tastingMenuLabels?.[2]),
      };
    default:
      return null;
  }
}

/**
 * Try to fetch a Wikipedia reference image for a tasting menu item and
 * run a background-only edit so the actual product/book/film shows up
 * rather than a Gemini fabrication. If the Wikipedia lookup fails,
 * falls through to text-only generation.
 */
export async function generateTastingImageWithReference(
  apiKey: string,
  slotPrompt: string,
  sectionTag: string,
  subject: string,
  kind: "book" | "film" | "product" | "drink" | "unknown",
): Promise<{ bytes: Uint8Array; mimeType: string; usedReference: boolean; referenceUrl?: string }> {
  const kindHint =
    kind === "film"
      ? "film"
      : kind === "book"
        ? "novel"
        : kind === "product"
          ? "product"
          : kind === "drink"
            ? ""
            : "";

  let reference: Awaited<ReturnType<typeof fetchSubjectReferenceImage>> = null;
  try {
    reference = await fetchSubjectReferenceImage(subject, kindHint);
  } catch (err) {
    console.warn(
      "latte.tasting_reference_lookup_failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  if (!reference) {
    const gen = await generateOneImage(apiKey, slotPrompt, sectionTag);
    return { ...gen, usedReference: false };
  }

  // For films: rotate 30/70 between keyframe mode and poster mode.
  // Keyframe used to be 50/50 but Austin wanted more variety - posters
  // now dominate, keyframe shows up ~30% of the time. Poster mode has
  // 8+ different setting types (framed wall, cinema lobby easel,
  // sidewalk kiosk, art-house lobby, held by person, etc) so variety
  // within poster mode is already high.
  // - Poster mode: Wikipedia poster in a poster-native portrait setting.
  // - Keyframe mode: Gemini generates a landscape "still" from the film,
  //   guided by a per-film visual-style research pass so the still
  //   mimics the SPECIFIC film's actual cinematography rather than
  //   defaulting to generic AI-golden-hour aesthetics.
  // If the visual-style research returns null (film not well-enough-
  // known), fall back to poster mode for this issue.
  let filmUseKeyframe = kind === "film" ? Math.random() < 0.3 : false;
  let filmVisualStyle: string | null = null;
  if (filmUseKeyframe) {
    filmVisualStyle = await researchFilmVisualStyle(subject);
    if (!filmVisualStyle) {
      console.info("latte.film_style_unknown_falling_back_to_poster", { film: subject });
      filmUseKeyframe = false;
    }
  }

  const preservationNote =
    kind === "film"
      ? filmUseKeyframe && filmVisualStyle
        ? `This slot is a "keyframe" from the film "${subject}" — a plausible landscape still shot from the movie, rendered as if it IS the still from the actual movie. **DO NOT frame this as "a TV playing the movie in a living room." DO NOT include any TV, laptop, tablet, phone, monitor, or screen device in the image. DO NOT include a viewer, a watcher, a person on a couch, a hand on a remote, a silhouette watching, or ANY human figure that is not an actor from the film itself. The frame IS the film scene — nothing framing it, nothing observing it.**

**ONLY people allowed in the frame are actors from the film performing in-character.** No editorial viewers, no reflected watchers in a screen, no partial silhouettes indicating a viewer's presence. If no actor is confidently identifiable for a given scene, show a landscape/environment shot from the film (setting only, no people) rather than inventing anonymous "watcher" figures.

**CONTENT RULES (this is an adult audience — the goal is refined, not sanitized):**
- **NO nudity or partial nudity.** No exposed skin beyond ordinary casual dress. No bathtub scenes, no shower scenes, no lingerie, no towel-wrapped subjects, no characters undressed or in bed under sheets. Even if the actual film has such a scene (Margot Robbie in the bathtub in The Big Short, any Wolf of Wall Street bedroom scene, any period drama boudoir moment), we do NOT render it.
- **NO overly sexual framing** — no romantic-tension close-ups framed as boudoir, no bedroom framing that reads as intimate regardless of clothing, no suggestive undressing.
- **KISSING and EMBRACING between fully-clothed characters ARE allowed.** A hug at a train station, a kiss under streetlight, a couple holding each other on a porch — all fine. Just keep it fully-clothed and not framed as bedroom/boudoir.
- **WAR and ACTION scenes ARE allowed at wide or medium framing.** A peppered battlefield with explosions and soldiers running, a wide shot of combat, an action chase with characters in motion — all fine for an adult audience. Real news-style war photography (photojournalist framing of a specific real conflict) is NOT what we want — we want cinematic war framing that reads as this specific film.
- **NO overly gory imagery.** No close-up wounds, no arterial blood, no lingering injury detail, no gruesome dwelling on damage. Combat at cinematic distance is fine; a close-up of a bloody wound is not.
- **NO drug or alcohol overuse imagery.** A glass of wine on a table is fine. A character visibly drunk / drugged / passed out is not.
- **Also great:** characters in conversation, landscape shots from the film (mountains, deserts, cityscapes with tiny figures), driving scenes, walking scenes, working-at-a-desk scenes, wide establishing shots, quiet outdoor moments.
- If the film's ONLY memorable scenes would still cross the lines above (a purely erotic film, a torture-porn film), fall back to a landscape/environment shot from the film (setting only, no characters).

**CRITICAL: this must look like a REAL still from THIS SPECIFIC film, not a generic AI-cinematic image.** Real film stills are shot with real cameras by real cinematographers with distinctive visual signatures. AI defaults to generic "golden-hour hero-shot" aesthetics that read as fake.

**Visual-style profile for THIS film (research summary):**
${filmVisualStyle}

**Mimic that visual style exactly.** Match the color palette, framing conventions, lighting habits, and camera format described above. If the profile says "warm ochres and desaturated earth tones," use those — DO NOT default to teal-and-orange. If the profile says "symmetric center-framed," use that — DO NOT invent asymmetric handheld. If the profile says "wide vistas with tiny figures for scale," use that — DO NOT default to close-up hero shots.

**Add real-camera character** — visible film grain (if the film was shot on 35mm/IMAX/16mm), realistic lens flare only where a real camera would produce it, focus fall-off consistent with the film's aperture choices, no plastic AI over-smoothing, no HDR-look processing, no cinematic teal-orange color grading unless the film actually uses it.

**Composition rule:** the still should look like a paused frame from the actual movie. Real film compositions are often IMPERFECT (an actor slightly off-center, a foreground element partially cropped, ambient details in the environment). Perfectly-composed hero-shot symmetry is the AI tell.

**Reference the poster (attached below) for:** the film's color palette, the type of subject matter, the character(s) if identifiable, the general mood. Use it to inform what the film looks like — but DO NOT include the poster in the output. Render the actual scene, not the poster.

**ABSOLUTE RULE: THE MOVIE POSTER APPEARS NOWHERE IN THE OUTPUT IMAGE. NOT ON A WALL. NOT ANYWHERE. NOT INSIDE THE FILM SCENE.**

You have been given the poster as REFERENCE input only. It is a color/subject/character guide. It is NOT to be visible in the output.

**The frame IS the film scene.** No TVs, no viewing rooms, no cozy living rooms wrapping the scene. If you imagined a photo of a TV playing this movie, WRONG — imagine instead you are a movie photographer on set, and this is a production still from the film. That is the target aesthetic.`
        : "This is the official movie POSTER for the film. Preserve the poster artwork and title text exactly. **Show the poster ONLY in poster-appropriate portrait settings** where it would naturally hang. Rotate the setting across issues — pick ONE from: a framed print on a residential wall (movie room, hallway, apartment, home theater), an easel outside a cinema at dusk, an A-frame poster stand on a sidewalk, an art-house lobby wall with warm interior light, a bulletin-board-style community poster wall, held/carried by a person shown from behind (no face), a movie theater lobby marquee-adjacent poster board, or a poster shop / gallery display. **DO NOT show the poster on any TV, laptop, tablet, or phone screen** — a portrait poster does not fill a landscape screen. The scene around the poster should be editorial per the setting prompt below."
      : kind === "book"
        ? "This is the official BOOK COVER for the book. **The title text on the cover MUST be preserved EXACTLY as it appears** — do not modify letterforms, do not stylize the typography, do not blur the title, do not paraphrase or invent alternative words. If you cannot render the exact title clearly, prefer camera angles where the title is small in frame or partially obscured by another object (a hand on the cover, an angled view, the book partially closed) rather than rendering a centered garbled version. The cover art must also be preserved exactly. **THE BOOK COVER MUST BE CLEAN — do NOT put crumbs, tater tots, food particles, herb sprigs, coffee grounds, sugar, salt, spilled liquid, or ANY debris on the cover or on the surface next to the book.** A book is not a food frame. Show the book alone on the surface with editorial-appropriate context per the setting prompt below (a wooden table, windowsill, bedside table, leather armchair, café tabletop — clean, no debris)."
        : kind === "product"
          ? "This is the official product photo. Preserve the product form factor, proportions, color, branding, and any physical details exactly (handle placement, port locations, dimensions). The product must appear as it actually exists - do not invent broken/modified variants. Place the product in the editorial context described in the setting prompt below."
          : "Preserve the subject exactly as the reference shows. Place it in the editorial context described in the setting prompt below.";

  const instruction = `${sectionTag}

=== REFERENCE-IMAGE MODE for Tasting Menu ===

The image below is a real reference of "${subject}" pulled from Wikipedia.

${preservationNote}

You may change the SURROUNDING SCENE (background, light, other props, framing) per the editorial setting prompt below. You may NOT change any aspect of the reference subject itself (its form factor, artwork, title text, branding, or physical details).

The output must be a 1:1 SQUARE aspect ratio image.

=== EDITORIAL SETTING ===

${slotPrompt}${LATTE_IMAGE_STYLE_SUFFIX}

REMINDER: the subject "${subject}" must appear per the reference image. Only the surrounding editorial scene may change.`;

  const base64 = Buffer.from(reference.bytes).toString("base64");
  try {
    const edited = await callGemini(apiKey, [
      { text: instruction },
      { inlineData: { mimeType: reference.mimeType, data: base64 } },
    ]);
    return {
      bytes: edited.bytes,
      mimeType: edited.mimeType,
      usedReference: true,
      referenceUrl: reference.sourceUrl,
    };
  } catch (err) {
    console.warn(
      "latte.tasting_edit_failed_using_reference_direct",
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

async function generateForSlot(
  apiKey: string,
  slot: string,
  prompt: string,
  sectionTag: string,
  subjects: LatteImageSubjects,
): Promise<{ bytes: Uint8Array; mimeType: string; usedReference?: boolean; referenceUrl?: string }> {
  if (slot === "the-drive" && subjects.theDriveCar.trim() !== "") {
    return generateDriveImageWithReference(apiKey, prompt, sectionTag, subjects.theDriveCar);
  }
  if (slot.startsWith("tasting-")) {
    const idx = slot === "tasting-1" ? 0 : slot === "tasting-2" ? 1 : slot === "tasting-3" ? 2 : -1;
    if (idx >= 0) {
      const subject = subjects.tastingMenuTitles[idx] ?? "";
      const label = subjects.tastingMenuLabels?.[idx] ?? "";
      const kind = tastingKindFor(label);
      if (subject.trim() !== "") {
        return generateTastingImageWithReference(apiKey, prompt, sectionTag, subject, kind);
      }
    }
  }
  // Hero: try a landmark visual-detail research pass. If Haiku knows
  // the landmark, inject the concrete visual characteristics into the
  // Gemini prompt so it renders accurately (Chinati sculptures are
  // hollow rectangles in rows, not solid bricks). If unknown, ships
  // with the writer's prompt unchanged.
  if (slot === "hero" && subjects.coverStoryLocation.trim() !== "") {
    const landmarkDetail = await researchLandmarkVisualDetail(subjects.coverStoryLocation);
    if (landmarkDetail) {
      const enrichedPrompt = `${prompt}

**LANDMARK ACCURACY REQUIREMENT (research summary for the landmark in this scene):**
${landmarkDetail}

Render the landmark faithfully to these specific visual characteristics. Do NOT generate a generic "concrete blocks in a desert" or "adobe buildings" or similar approximation - render the actual geometry, proportions, and material as described above.`;
      return generateOneImage(apiKey, enrichedPrompt, sectionTag);
    }
  }
  return generateOneImage(apiKey, prompt, sectionTag);
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
): Promise<{
  url: string;
  usedReference?: boolean;
  referenceUrl?: string;
  verdict?: {
    attempts: number;
    passed: boolean;
    finalReason?: string;
    usedFallbackToReference?: boolean;
  };
}> {
  const ctx = validatorContextFor(slot, subjects);

  // Attempt 1
  let img = await generateForSlot(apiKey, slot, prompt, sectionTag, subjects);
  let attempts = 1;
  let verdict: ImageValidatorVerdict | null = null;

  if (ctx) {
    verdict = await validateImage(img.bytes, img.mimeType, ctx);
  }

  // Attempt 2 with retry hint if attempt 1 failed validation
  if (ctx && verdict && !verdict.ok) {
    console.warn("latte.image_validator_fail_attempt1", {
      slot,
      reason: verdict.reason,
      hint: verdict.retryHint,
    });
    attempts = 2;
    const sharpenedPrompt = `${prompt}

CRITICAL FIX ON RETRY: A previous attempt to generate this exact image failed validation. The specific problem was: ${verdict.reason}. ${verdict.retryHint ? `To fix: ${verdict.retryHint}.` : ""} Do NOT repeat that failure this time.`;
    img = await generateForSlot(apiKey, slot, sharpenedPrompt, sectionTag, subjects);
    verdict = await validateImage(img.bytes, img.mimeType, ctx);
  }

  // For theDrive: this slot must NEVER ship the raw dealership press
  // photo (user's absolute rule). If both attempts above failed
  // validation, run one more attempt with an EVEN sharper prompt that
  // stacks both prior failure reasons. Then ship whatever the last
  // Gemini attempt produced - a Gemini-edited image (even one the
  // validator complained about) is preferable to a raw dealership shot.
  const usedFallbackToReference = false;
  if (ctx && verdict && !verdict.ok && slot === "the-drive") {
    console.warn("latte.image_drive_validator_fail_third_attempt", {
      slot,
      reason_1: verdict.reason,
    });
    attempts = 3;
    const evenSharperPrompt = `${prompt}

CRITICAL FIX - THIRD ATTEMPT: Two prior attempts to generate this image failed validation. The specific problems were:

Failure A: ${verdict.reason}

You MUST address both failures in this attempt. Focus on: correct car generation (matching the reference car body exactly), clean brand badge rendering, off-center rule-of-thirds composition, no AI artifacts, no aftermarket-looking modifications, no wrong-generation drift. This is the last attempt - the output will be shipped as-is. Do not add motion blur unless the scene demands it. Do not synthesize missing angles of the car - keep the pose from the reference.`;
    try {
      const thirdImg = await generateForSlot(apiKey, slot, evenSharperPrompt, sectionTag, subjects);
      img = thirdImg;
      const thirdVerdict = await validateImage(img.bytes, img.mimeType, ctx);
      verdict = thirdVerdict;
      if (!thirdVerdict.ok) {
        console.warn("latte.image_drive_third_attempt_failed_shipping_anyway", {
          slot,
          reason: thirdVerdict.reason,
        });
      }
    } catch (err) {
      console.error(
        "latte.image_drive_third_attempt_threw",
        err instanceof Error ? err.message : String(err),
      );
      // Keep img from attempt 2 (the last successful Gemini call) - do
      // NOT fall back to raw reference.
    }
  }

  const filename = `${issueDate}/${slot}-${genStamp}.${extForMime(img.mimeType)}`;
  const publicUrl = await uploadToStorage(storage, img.bytes, filename, img.mimeType);
  return {
    url: publicUrl,
    ...(img.usedReference !== undefined ? { usedReference: img.usedReference } : {}),
    ...(img.referenceUrl ? { referenceUrl: img.referenceUrl } : {}),
    ...(ctx
      ? {
          verdict: {
            attempts,
            passed: verdict?.ok ?? true,
            ...(verdict?.reason ? { finalReason: verdict.reason } : {}),
            ...(usedFallbackToReference ? { usedFallbackToReference: true } : {}),
          },
        }
      : {}),
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
  const validatorVerdicts: NonNullable<ImageGenResult["validatorVerdicts"]> = [];
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
      if (res.value.verdict) {
        validatorVerdicts.push({
          slot: job.slot,
          attempts: res.value.verdict.attempts,
          passed: res.value.verdict.passed,
          ...(res.value.verdict.finalReason ? { finalReason: res.value.verdict.finalReason } : {}),
          ...(res.value.verdict.usedFallbackToReference
            ? { usedFallbackToReference: true }
            : {}),
        });
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
    validatorVerdicts,
  };
}
