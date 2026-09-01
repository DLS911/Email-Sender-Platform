/**
 * Post-generation image validator for Saturday Morning Latte.
 *
 * After each image is generated + uploaded, we run a Haiku 4.5 vision
 * check that asks: "does this image show what it's supposed to?"
 * The check is slot-aware — different questions for cars, products,
 * movies, cover-story locations, cooking techniques. Returns pass/fail
 * with a reason so the caller can retry with a sharpened prompt.
 *
 * Cost per validation: ~$0.003 (Haiku 4.5 vision on a single image).
 * 7 slots per issue = ~$0.02 added. Cheap defense-in-depth.
 */

import Anthropic from "@anthropic-ai/sdk";

const VALIDATOR_MODEL = "claude-haiku-4-5-20251001";

export type ImageValidatorSlot =
  | "hero"
  | "coverDetail"
  | "hostsCorner"
  | "theDrive"
  | "tastingMenu";

export type ImageValidatorContext = {
  slot: ImageValidatorSlot;
  /** The specific subject this image is supposed to depict. Car year+model,
   *  product name, movie title, location name, cooking technique. */
  subject: string;
  /** Tasting menu kind — book / film / product / drink. Optional signal
   *  the validator uses to check the right thing. */
  tastingKind?: "book" | "film" | "product" | "drink" | "unknown";
};

export type ImageValidatorVerdict = {
  ok: boolean;
  reason: string;
  /** Compact reason to append to a retry prompt if !ok. */
  retryHint?: string;
};

/**
 * Slot-specific validation questions. Each returns a prompt fragment
 * appended to the vision request. Kept terse — Haiku is fast when the
 * question is precise.
 */
function questionForSlot(ctx: ImageValidatorContext): string {
  switch (ctx.slot) {
    case "theDrive":
      return `This image is for "The Drive" section of a car newsletter. The car is supposed to be: ${ctx.subject}.

Check the following:
1. Is this the CORRECT year and generation of the car named? For example, a 2024 BMW M2 must be the G87 body (squared boxy fenders, slim horizontal LED headlights, tall vertical body-color kidney grille), NOT the F87 (rounded fenders, twin round headlights, small grilles).
2. Is the brand badge/logo rendered accurately (no scuffing, no half-formed shapes)?
3. Is the car body geometrically coherent (no aftermarket exaggerations, no mangled parts)?
3a. **WHEEL SIZE CHECK — AUTOMATIC FAIL if the wheels look undersized relative to the wheel arch.** Gemini sometimes shrinks wheels during a background edit, making the car look like it has doughnut spares. If the wheels appear noticeably smaller than they should for that specific car (visible gap between the tire and the top of the wheel arch that shouldn't be there), FAIL. Set retryHint to "wheels must match the reference size — do not shrink them; wheel diameter should fill the wheel arch the same fraction as the reference."
4. **PHYSICALLY REAL PLACEMENT — AUTOMATIC FAIL if wrong.** The car must sit on a legal driveable surface — paved road, dirt road, gravel, cobblestone, parking area, driveway, garage floor, showroom, canyon road, coastal highway pullout, gas station forecourt. If the car is in the ocean, in a river/pond/lake, partly submerged in water, on unaccessible rocks, on a beach with water at the tires, in the middle of a field with no visible path, on top of a mountain peak with no road, floating, or tilted at an impossible angle, FAIL. Set retryHint to "car must be on a real driveable surface — no water, no impossible terrain."
5. **Do not accept a race-spec RENDER when the writer picked a road car.** Aggressive factory aero is fine — a 911 GT3 RS swan-neck wing, a Z06 splitter, a Camaro ZL1 1LE tri-plane wing, a Cayman GT4 RS ducktail, a Corvette ZR1 rear wing are all street-legal. What DOES make this a fail: painted sponsor livery / team graphics / race number panels ("77", "12" painted on the door), a roll cage visible through the side windows, race harnesses through bucket seats, a tow strap dangling from the front splitter, racing slicks (bald competition tires with no tread), a fire-suit driver behind the wheel, or "PIRELLI GT" / "MICHELIN COMPETITION" tire sidewalls. Those belong on the GT3/GT4 race variant, not the road car. If any of THOSE are present, FAIL. Set retryHint to "the reference is the source of truth — render the ROAD version of this nameplate exactly, no invented race liveries or tow straps, treaded street tires."
5. Does the composition follow the rule of thirds (off-center subject, not dead center)?
6. Any obvious AI artifacts (impossible shadows, extra parts, distorted geometry)?

Verdict format:
- If everything is right: return {"ok": true, "reason": "brief summary"}
- If any of these fail: return {"ok": false, "reason": "the specific failure", "retryHint": "what to tell the image model to fix on retry"}`;

    case "tastingMenu": {
      const kind = ctx.tastingKind ?? "unknown";
      const kindNote = kind === "film"
        ? `For a film pick, the image is one of TWO modes:

**POSTER MODE:** the actual movie POSTER (from Wikipedia infobox) displayed in a poster-appropriate setting (framed wall, cinema easel, sidewalk kiosk, art-house lobby, home movie room, held by person from behind). **If the poster is on a TV/laptop/tablet/phone screen, FAIL.** If the poster looks stylized/AI-invented rather than the real Wikipedia poster, FAIL.

**KEYFRAME MODE:** a landscape still from the film rendered as if it IS the actual movie still — no TV, no laptop, no tablet, no phone, no screen device framing it. The frame IS the film scene. In keyframe mode:
- **If there is ANY TV, laptop, tablet, phone, monitor, or screen device visible in the image, FAIL.** The keyframe should look like a production still, not a photo of a screen playing a movie.
- **If there is a viewer, watcher, hand on a remote, silhouette of someone watching, couch in the foreground of a viewing room, or ANY person in the frame who is NOT an actor from the film performing in-character, FAIL.** Only in-film actors are allowed. If no actor is identifiable, the frame should show landscape/environment only, no people.
- **LEGIBILITY FLOOR — AUTOMATIC FAIL if too dark.** The keyframe ships as a small thumbnail in a newsletter, viewed on phones/desktops at coffee-shop brightness. If the image renders as mostly black — subjects lost in shadow, no clearly visible faces or silhouettes against the background, key elements crushed to pure black, image reads as a dark rectangle at thumbnail scale — FAIL. Set retryHint to "lift shadows and increase exposure; the film's palette can stay accurate but the frame must be legible at 600px thumbnail scale." Even if the source film is genuinely dark (The Penguin, The Batman, Sicario, film noir), a black-rectangle rendering fails.
- **If the poster appears anywhere in the scene (framed on a wall, on a shelf, on a table), FAIL.**
- **NUDITY / OVERLY SEXUAL / OVERLY GORY content is an automatic FAIL** even if the source film has such scenes. Look for: nudity, partial nudity, exposed skin beyond ordinary dress, bathtub scenes, shower scenes, lingerie, characters undressed in bed, romantic-tension close-ups framed as bedroom/boudoir, heavy blood, close-up wounds, gruesome injury detail.
- **ALLOWED (do NOT fail):** kissing, embracing, hugging, tender contact between fully-clothed characters. War action scenes are OK if shown at wide/medium framing — peppered battlefield with explosions and people running is fine for an adult audience. Reject only when it crosses into gore.
- Neutral content is also fine: conversations, driving, walking, landscapes, wide establishing shots, desk work.`
        : kind === "book"
          ? "For a book pick, the image shows the actual book with a reasonable cover, on a table with contextual props (coffee cup, window light, glasses, a bookmark). **NO decorative botanicals or seasonal debris on or near the book — a single fall leaf on the cover is a FAIL, flower petals beside it is a FAIL, a sprig of eucalyptus/rosemary/lavender is a FAIL, pinecones/acorns/feathers/pressed botanicals of any kind are a FAIL.** The book is the subject, not the book plus a Pinterest botanical accent."
          : kind === "product"
            ? "For a product pick, the image must show the ACTUAL product (matching real-world form factor - correct handle placement, correct ports, correct shape). No hallucinated broken versions."
            : kind === "drink"
              ? "For a drink pick, the image should show the actual bottle/glass with the drink recognizable."
              : "";

      return `This image is for the Tasting Menu section of a lifestyle newsletter. The item is supposed to be: ${ctx.subject}.

${kindNote}

Check the following:
1. Does this image clearly represent the specific item named (correct product/book/film)?
2. Are there any physically impossible or broken details (a handle in the wrong place, a torn cover, a distorted shape)?
3. **NO SPURIOUS DECORATIVE DEBRIS.** A single coffee bean sitting near an espresso machine is a FAIL. A single tea leaf near a teapot is a FAIL. A single stray herb sprig near a knife is a FAIL. Products live cleanly on their surface. Category-adjacent debris counts as debris.
4. **NO SELF-ACTUATING PRODUCTS. AUTOMATIC FAIL.** A grinder is not actively grinding by itself. A brew grinder / coffee maker / espresso machine is not pouring itself into anything. A jar is not tipping and pouring. A blender is not blending. The product must be AT REST on a surface. If you see the product mid-action with no human agent, FAIL and set retryHint to "product must be sitting at rest, not operating itself — no self-pouring, no self-grinding, no invisible-hand operations".
5. **NO FLOATING PRODUCTS. AUTOMATIC FAIL.** Every product must be gravitationally supported by a visible surface — counter, table, shelf. If the product hovers with no support, FAIL and set retryHint to "ground the product on the counter — no floating".
6. **For books:** the title text on the cover must be legible and match the actual book title. Garbled letterforms or stylized-different-words is a FAIL. If the item is named as a book (a novel, non-fiction title) and the image shows the item as an object OTHER than a book — e.g. a satellite, a sports ball, a household appliance — that is a FAIL. The book kind renders as a book, period.
7. Any obvious AI artifacts (extra objects, distorted geometry, impossible physics)?
8. Does the composition follow the rule of thirds (off-center subject, not dead center)?

Verdict format:
- If everything is right: return {"ok": true, "reason": "brief summary"}
- If any of these fail: return {"ok": false, "reason": "the specific failure", "retryHint": "what to tell the image model to fix on retry"}`;
    }

    case "hostsCorner":
      return `This image is for the Host's Corner cooking section. The technique is: ${ctx.subject}.

Check the following:
1. Does the image show the SPECIFIC cooking technique or its result (not a generic kitchen scene)?
2. **NO HANDS, ARMS, OR HUMANS in the frame.** Food images must never show hands holding a spatula, fingers cutting, arms lifting - the geometry always renders wrong. If a hand is visible, FAIL this validation.
3. **Kitchen physics + no spills:** hot cookware belongs on a stove, stone, or trivet — NEVER on bare wood. No random grease/oil puddles on the counter or table beside the pan. **NO SPILLED LIQUID** — no puddle of coffee, tea, oil, wine, sauce, or water on the counter/table/board. A drink stain or spill anywhere in the frame is an AUTOMATIC FAIL. Real cooking scenes have surfaces WIPED CLEAN of spills; the pan is where the action is, everywhere else is clean.
4. **Steam physics is an AUTOMATIC FAIL if wrong.** Steam ONLY escapes from open apertures. A kettle with a closed lid must NOT show steam plumes from the top of the lid, from the lid seam, or from anywhere except an open spout. Pour-over gooseneck kettles (Fellow Stagg, Hario Buono, Chemex-adjacent) always have closed lids — steam should come from the pouring stream hitting the coffee bed, not from the kettle top. If you see steam venting from the top of a closed lid, or from the sides of any closed vessel, FAIL and set retryHint to "kettle has closed lid — remove all steam plumes from the top of the lid and only show steam from the pouring stream / open cup / hot food".
5. **Self-actuating objects are an AUTOMATIC FAIL.** With no hands allowed in food frames, no object may be depicted mid-action operating itself. If the kettle is tilted mid-pour with no hand holding it, FAIL. If a jar is pouring itself, FAIL. If a bottle is levitating over a pan, FAIL. The correct render is the object AT REST — upright, sitting on a surface. Set retryHint to "no hands allowed and no self-actuating objects — set the kettle upright on the stove/trivet, or show only the finished cup with the kettle off-frame".
6. **Floating objects are an AUTOMATIC FAIL.** Every object must sit on a visible surface — stove, counter, trivet, cutting board, cast iron rack. If the pan, kettle, grinder, or any product hovers above the surface with no visible support, FAIL. Set retryHint to "ground the product on the counter/stove/trivet — no hovering".
5. Composition off-center, not dead-center.
6. Any AI artifacts.

Verdict format:
- If everything is right: return {"ok": true, "reason": "brief summary"}
- If any of these fail: return {"ok": false, "reason": "the specific failure", "retryHint": "what to tell the image model to fix"}`;

    case "hero":
      return `This image is the Hero (top banner) for a Cover Story. The location is: ${ctx.subject}.

Check the following:
1. Does the image show something recognizably from THIS specific location (a signature landmark, geography, architecture, or feature - not a generic version of that kind of place)?
2. **Geographic accuracy: does the image invent impossible proximity between features?** For example, a Burlington VT scene where downtown brick storefronts open directly onto Lake Champlain is wrong - real Burlington has streets, a park, and open ground between downtown and the water. Rendering a compressed impossible relationship between features is a FAIL.
2b. **Structural coherence — AUTOMATIC FAIL on half-built infrastructure.** Every man-made structure must be COMPLETE and CONNECTED. Fail if you see: a bridge that vanishes into fog / water / nothing on the far side (a "dead-end bridge"); a lift or bascule bridge in the RAISED position with NO visible far-shore landing (the raised span leads nowhere); a road that terminates in an open field with no destination; a pier floating in the middle of open water with no shore connection; a building with walls that stop halfway or a house with no visible foundation; a fence / rail / power line consisting of one isolated segment. Set retryHint to "render the structure complete on BOTH ends — for a lift bridge either lower it and show the full deck OR show both approaches with a matching landing on the far shore; for roads/piers/rails, connect them to a visible destination or leave them out of frame."
3. **NO SPURIOUS ON-IMAGE TEXT.** If the image has ANY text spelling out the location name (a "Welcome to ${ctx.subject}" sign, a "${ctx.subject} Cove" placard, a wooden sign carved with the town name, a chalkboard titled with the destination, a garbled banner across the top), that is an AUTOMATIC FAIL. Any typography that reads as the destination name — anywhere in the frame, on any object, in any style — fails this check. Also fail: watermarks, made-up title overlays, decorative letters that don't belong to real signage. Real generic in-scene signage that reads correctly (a legible "MAIN ST" street sign, a "STOP" sign, a route marker) is fine, as long as it does not spell the location name.
4. **MINIMAL PEOPLE — AUTOMATIC FAIL if crowded.** Hero should rely on nature / architecture / geography for beauty, not on people. 0-2 people in the frame is fine (a single figure walking a beach, two people at a distance on a pier). Any of the following is a FAIL: a crowd, a group of 3+ people all facing camera, a busy sidewalk of tourists, a plaza filled with people, people posing. Also fail: multiple obviously-AI-generated faces staring at nothing. Retry hint: "remove people from the frame — this hero should be pure landscape / architecture, at most one distant figure."
5. Are people (if any 1-2) facing meaningful subjects, not staring at nothing (no AI zombie stares)?
6. Composition off-center, not dead-center.
7. Water surfaces have realistic ripples (not glassy AI-perfect reflections). Fog has directional structure (not uniform gradient).
8. Any AI artifacts.

Verdict format:
- If right: {"ok": true, "reason": "brief"}
- If wrong: {"ok": false, "reason": "specific failure", "retryHint": "what to fix"}`;

    case "coverDetail":
      return `This image is a Cover Story Detail shot. The location the story is about is: ${ctx.subject}. The image is supposed to be a ONE specific detail from that place (a hand on a rail, a doorway at a specific time of day, a specific object in situ).

Check the following:
1. Does the detail feel specific to the named location (not a generic version)?
2. **GENERIC-SCENE AUTOMATIC FAIL.** If the image is a street food stand, a food stall, a night market crowd, a busy morning market, a bustling plaza, a generic downtown crowd, people milling around, or any "market scene / crowd scene" default — FAIL. Cover Detail must be a TIGHT editorial still-life OR a single named architectural / interior / object detail. Set retryHint to "rewrite as a tight still-life or single named architectural element at a specific spot — no crowd scenes, no generic food stands."
3. **Realistic quantities of objects that come in sets.** A bar with ONE stool is a FAIL - bars have multiple stools. A restaurant with one lonely table is a FAIL. A dining table with one chair is a FAIL. Depict realistic multiples.
4. Rule of thirds composition, off-center.
5. Any physics issues (impossible steam, wrong reflections, floating debris)?
6. Any AI artifacts (mangled logos, distorted geometry)?
7. If people are in frame, do they face meaningful subjects (no zombie stares)?

Verdict format:
- If right: {"ok": true, "reason": "brief"}
- If wrong: {"ok": false, "reason": "specific failure", "retryHint": "what to fix"}`;
  }
}

/**
 * Run the vision check. Returns a verdict. Never throws — a network or
 * parse failure returns {ok: true, reason: "validator unavailable"} so
 * the pipeline doesn't stall on a transient error.
 */
export async function validateImage(
  bytes: Uint8Array,
  mimeType: string,
  ctx: ImageValidatorContext,
): Promise<ImageValidatorVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: true, reason: "ANTHROPIC_API_KEY missing; skipping validation" };

  try {
    const client = new Anthropic({ apiKey });
    const question = questionForSlot(ctx);
    const b64 = Buffer.from(bytes).toString("base64");
    const imageMime = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
    const response = await client.messages.create({
      model: VALIDATOR_MODEL,
      max_tokens: 500,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question },
            {
              type: "image",
              source: {
                type: "base64",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                media_type: imageMime as any,
                data: b64,
              },
            },
            { type: "text", text: "\n\nReturn ONLY the JSON verdict, no preamble." },
          ],
        },
      ],
    });

    let text = "";
    for (const block of response.content) if (block.type === "text") text += block.text;
    const stripped = text.replace(/```json\s*|\s*```/g, "").trim();
    const firstBrace = stripped.indexOf("{");
    const lastBrace = stripped.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      return { ok: true, reason: "validator returned no JSON; assuming ok" };
    }
    const parsed = JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as {
      ok?: boolean;
      reason?: string;
      retryHint?: string;
    };
    const verdict: ImageValidatorVerdict = {
      ok: parsed.ok === true,
      reason: String(parsed.reason ?? ""),
    };
    if (parsed.retryHint) verdict.retryHint = String(parsed.retryHint);
    return verdict;
  } catch (err) {
    console.warn(
      "latte.image_validator_failed",
      err instanceof Error ? err.message : String(err),
    );
    return { ok: true, reason: "validator threw; assuming ok" };
  }
}
