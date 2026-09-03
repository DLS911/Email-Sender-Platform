/**
 * v2 research stage — runs BEFORE the writer. Produces a visualFacts
 * block that gets injected into the writer's context so the writer
 * writes image prompts grounded in real named features.
 *
 * Three focused Haiku calls in parallel: place, dish, car. Each returns
 * ~120 words. If any errors, its facts are omitted from visualFacts.
 */

import Anthropic from "@anthropic-ai/sdk";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type VisualFacts = {
  place?: {
    landmarks: string[];
    signatureSubject?: string;
    doNotConflate?: string;
    raw: string;
  };
  dish?: {
    state: "in-progress" | "plated" | "unknown";
    cookware: string;
    utensil?: string;
    surface: string;
    raw: string;
  };
  car?: {
    generationCode?: string;
    features: string[];
    periodColors: string[];
    typicalSetting?: string;
    raw: string;
  };
};

async function haikuTextCall(system: string, user: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 700,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    });
    let text = "";
    for (const block of resp.content) if (block.type === "text") text += block.text;
    text = text.trim();
    if (!text || text.toUpperCase() === "UNKNOWN" || text.length < 40) return null;
    return text;
  } catch (err) {
    console.warn("latte-v2.haiku_research_failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function researchPlace(location: string): Promise<VisualFacts["place"] | undefined> {
  if (!location.trim()) return undefined;
  const raw = await haikuTextCall(
    `You produce a visual facts block for a place, for downstream image-prompt writing. Return in this exact format:

LANDMARKS:
- <name>: <one sentence with concrete visual facts — geometry / material / colour / scale>
- <name>: <same>
- <name>: <same>

SIGNATURE_SUBJECT: <if the place has a signature living/happening subject a visitor associates with it — whales, sperm-whale flukes, dancers in traje, kayakers, cyclists on a specific pass, ferries in a specific harbor — name it in one line. If nothing specific, write NONE.>

DO_NOT_CONFLATE: <features that are visually or geographically distinct and shouldn't be shown together — e.g. "downtown brick buildings are not adjacent to the waterfront in Burlington VT". If nothing, write NONE.>

Return "UNKNOWN" if you don't know the place well enough.`,
    `Place: ${location}`,
  );
  if (!raw) return undefined;
  const landmarks: string[] = [];
  let signatureSubject: string | undefined;
  let doNotConflate: string | undefined;
  const lines = raw.split(/\r?\n/);
  let inLandmarks = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^LANDMARKS:/i.test(trimmed)) {
      inLandmarks = true;
      continue;
    }
    if (/^SIGNATURE_SUBJECT:/i.test(trimmed)) {
      inLandmarks = false;
      const val = trimmed.replace(/^SIGNATURE_SUBJECT:\s*/i, "").trim();
      if (val && val.toUpperCase() !== "NONE") signatureSubject = val;
      continue;
    }
    if (/^DO_NOT_CONFLATE:/i.test(trimmed)) {
      inLandmarks = false;
      const val = trimmed.replace(/^DO_NOT_CONFLATE:\s*/i, "").trim();
      if (val && val.toUpperCase() !== "NONE") doNotConflate = val;
      continue;
    }
    if (inLandmarks && trimmed.startsWith("-")) {
      landmarks.push(trimmed.replace(/^-\s*/, ""));
    }
  }
  const place: VisualFacts["place"] = { landmarks, raw };
  if (signatureSubject) place.signatureSubject = signatureSubject;
  if (doNotConflate) place.doNotConflate = doNotConflate;
  return place;
}

export async function researchDish(moveTitle: string): Promise<VisualFacts["dish"] | undefined> {
  if (!moveTitle.trim()) return undefined;
  const raw = await haikuTextCall(
    `You produce a visual facts block for a cooking technique or dish, for downstream image-prompt writing. Return in this exact format:

STATE: <"in-progress" if the move is about a technique caught mid-action (a sear, a smash, a bloom, a proof, a reduction) — describe what's happening in the pan. "plated" if the move is about the finished dish on a plate.>

ICONIC_MARKERS: <2-3 concrete features that make this technique/dish recognisable — colour, texture, doneness, arrangement.>

COOKWARE: <exact cookware type — wok / dutch oven / cast iron skillet / carbon-steel skillet / saute pan / roasting pan / sheet pan / paella pan / stockpot / etc. If in-progress, what surface it's on — gas grate / induction / trivet / stone slab.>

UTENSIL: <the right utensil for this technique — silicone spatula for eggs, wooden spoon for stew simmer, metal spatula for smash burgers. NONE if no utensil belongs in the frame.>

SURFACE: <the surface the frame's key element rests on — stove grate, wooden cutting board, marble counter, plate on a linen napkin, wire rack, trivet.>

Return "UNKNOWN" if you don't know the technique well enough.`,
    `Move: ${moveTitle}`,
  );
  if (!raw) return undefined;
  const parse = (label: string): string => {
    const re = new RegExp(`^${label}:\\s*(.+)$`, "im");
    const m = raw.match(re);
    return m?.[1]?.trim() ?? "";
  };
  const stateRaw = parse("STATE").toLowerCase();
  const state: VisualFacts["dish"] extends infer T ? (T extends { state: infer S } ? S : never) : never =
    stateRaw.startsWith("in-progress") ? "in-progress"
    : stateRaw.startsWith("plated") ? "plated"
    : "unknown";
  const cookware = parse("COOKWARE") || "unspecified";
  const utensilRaw = parse("UTENSIL");
  const surface = parse("SURFACE") || "unspecified";
  const dish: VisualFacts["dish"] = { state, cookware, surface, raw };
  if (utensilRaw && utensilRaw.toUpperCase() !== "NONE") dish.utensil = utensilRaw;
  return dish;
}

export async function researchCar(carName: string): Promise<VisualFacts["car"] | undefined> {
  if (!carName.trim()) return undefined;
  const raw = await haikuTextCall(
    `You produce a visual facts block for a specific car, for downstream image-prompt writing. Return in this exact format:

GENERATION_CODE: <the chassis / generation code if applicable — G87, F87, 992.1, C8, ND, W124, R32, etc. If not applicable / not well known, write NONE.>

FEATURES:
- <feature 1 — one distinguishing visual detail: bodywork, headlights, taillights, exhaust, grille, wheels, that visually separates this generation from the previous>
- <feature 2>
- <feature 3>
- <feature 4>
- <feature 5>

PERIOD_COLORS:
- <one iconic period-correct colour for this car>
- <another>
- <another>

TYPICAL_SETTING: <the editorial setting this car reads best in — coastal marina at 7:30am / mountain switchback at golden hour / dealership showroom / dusty desert road / cobblestone European city / warehouse garage.>

Return "UNKNOWN" if you don't know the car well enough.`,
    `Car: ${carName}`,
  );
  if (!raw) return undefined;
  const features: string[] = [];
  const periodColors: string[] = [];
  let generationCode: string | undefined;
  let typicalSetting: string | undefined;
  const lines = raw.split(/\r?\n/);
  let section: "features" | "colors" | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^GENERATION_CODE:/i.test(trimmed)) {
      section = null;
      const val = trimmed.replace(/^GENERATION_CODE:\s*/i, "").trim();
      if (val && val.toUpperCase() !== "NONE") generationCode = val;
      continue;
    }
    if (/^FEATURES:/i.test(trimmed)) { section = "features"; continue; }
    if (/^PERIOD_COLORS:/i.test(trimmed)) { section = "colors"; continue; }
    if (/^TYPICAL_SETTING:/i.test(trimmed)) {
      section = null;
      const val = trimmed.replace(/^TYPICAL_SETTING:\s*/i, "").trim();
      if (val && val.toUpperCase() !== "NONE") typicalSetting = val;
      continue;
    }
    if (section === "features" && trimmed.startsWith("-")) features.push(trimmed.replace(/^-\s*/, ""));
    if (section === "colors" && trimmed.startsWith("-")) periodColors.push(trimmed.replace(/^-\s*/, ""));
  }
  const car: VisualFacts["car"] = { features, periodColors, raw };
  if (generationCode) car.generationCode = generationCode;
  if (typicalSetting) car.typicalSetting = typicalSetting;
  return car;
}

/**
 * Format visualFacts as a compact block that can be prepended to the
 * writer's system prompt. Only includes sections that resolved.
 */
export function formatVisualFactsForWriter(facts: VisualFacts): string {
  const parts: string[] = [];
  if (facts.place) {
    parts.push(`## visualFacts.place\n${facts.place.raw}`);
  }
  if (facts.dish) {
    parts.push(`## visualFacts.dish\n${facts.dish.raw}`);
  }
  if (facts.car) {
    parts.push(`## visualFacts.car\n${facts.car.raw}`);
  }
  if (parts.length === 0) return "";
  return `\n\n# VISUAL FACTS (research complete — use these named landmarks / cookware / features in your imagePrompts)\n\n${parts.join("\n\n")}\n`;
}
