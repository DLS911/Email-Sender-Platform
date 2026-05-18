/**
 * Saturday Morning Latte generator.
 *
 * Two-phase: Perplexity research for travel/products/cars + Claude writer
 * with the composed weekend voice modules.
 *
 * The research target is different from Daily Grind. Latte items are about
 * destinations, products, cars, restaurants, books, films — not industry
 * news. Research returns a bundle of grounded items that the writer can
 * pull from for Tasting Menu picks, Cover Story location facts, The Drive
 * car selection, and Host's Corner cooking technique.
 */
import Anthropic from "@anthropic-ai/sdk";
import { composeWeekendWriterVoice } from "./saturday-latte-voice-modules";
import { type LatteImagePrompts, generateLatteImages } from "./saturday-latte-images";
import { validateContentUrls } from "./saturday-latte-url-validate";
import type {
  LinkInBody,
  SaturdayLatteContent,
  TastingMenuItem,
} from "./saturday-latte-html-template";

const WRITER_MODEL = "claude-sonnet-4-5-20250929";
const WRITER_TEMPERATURE = 0.55;
const WRITER_MAX_TOKENS = 8000;
const IMAGE_PROMPT_MODEL = "claude-haiku-4-5-20251001";
const IMAGE_PROMPT_MAX_TOKENS = 1500;

const PERPLEXITY_MODEL = "sonar-pro";
const PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/chat/completions";

const ANTHROPIC_INPUT_PER_M = 3;
const ANTHROPIC_OUTPUT_PER_M = 15;

// ─── Research types ────────────────────────────────────────────────────────

export type LatteResearchItem = {
  category:
    | "destination"
    | "restaurant_food"
    | "product_kitchen"
    | "product_outdoor"
    | "car"
    | "wine_spirits"
    | "watch_listen_read"
    | "activity"
    | "other";
  title: string;
  url: string;
  source: string;
  publishedDate?: string;
  summary: string;
  insiderDetails?: string[]; // specific facts/quotes/prices
};

export type LatteResearch = {
  researchedOn: string;
  destinations: LatteResearchItem[];
  products: LatteResearchItem[];
  watchReadListen: LatteResearchItem[];
  cooking: LatteResearchItem[];
  cars: LatteResearchItem[];
};

// ─── Research phase via Perplexity ─────────────────────────────────────────

const RESEARCH_SYSTEM_PROMPT = `You are the research analyst for The Saturday Morning Latte, a lifestyle newsletter for established financial advisors. The newsletter covers travel, food, cars, products, cooking, and culture — not industry news. Your job is to find REAL, SPECIFIC, CITED items the writer can build sections around.

# WHAT THE NEWSLETTER NEEDS (split your search across these)

1. **Destinations** (Cover Story material): Real US or international places — small towns, off-season destinations, regional gems. Not generic top-10 lists. Specific places with specific reasons to visit. Examples: Savannah in January, Door County WI, Boise after the gold rush, Pittsburgh, Galveston.

2. **Restaurants / food spots** (for Tasting Menu Worth Eating or Cover Story specifics): real restaurants with real names and real menus. Hole-in-the-wall finds, chef-driven spots, regional specialties.

3. **Kitchen / outdoor products** (Tasting Menu and Host's Corner): real products with real prices and real specs. Yeti vs cheaper alternatives. Lodge cast iron. Pizza steel. Dutch ovens. Knives. Coffee equipment.

4. **Books, films, podcasts, music** (Tasting Menu Worth Watching/Reading/Listening): recent or noteworthy releases. Documentaries, novels, podcasts, albums.

5. **Cars** (The Drive): specific used or new vehicles worth recommending. Real specs, real model years, real prices. Mid-engine sports cars, GT cars, sleeper sedans, capable SUVs.

# QUALITY BAR
- Specific names, places, prices, model years. NO generic "luxury cooler" — use Yeti Tundra 65.
- Real publications only. Skip random blogs.
- Bias toward items with concrete specs/facts the writer can cite.
- Skip pure advertorial content.

# OUTPUT
Return ONLY this JSON object — no preamble, no markdown fences:

{
  "destinations": [ { category, title, url, source, publishedDate, summary, insiderDetails } ],
  "products": [ ... ],
  "watchReadListen": [ ... ],
  "cooking": [ ... ],
  "cars": [ ... ]
}

Each array can have 2-5 items. Total target: 12-20 items across all arrays. Quality over quantity.`;

type PerplexityResponse = {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    cost?: { total_cost?: number };
  };
};

function stripCodeFences(text: string): string {
  const t = text.trim();
  if (t.startsWith("```")) {
    const lines = t.split("\n");
    if (lines.length >= 3 && lines[lines.length - 1]!.startsWith("```")) {
      return lines.slice(1, -1).join("\n").trim();
    }
  }
  return t;
}

function extractJsonObject(text: string): string {
  const cleaned = stripCodeFences(text);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error(`no JSON object found in output: ${cleaned.slice(0, 200)}`);
  }
  return cleaned.slice(firstBrace, lastBrace + 1);
}

function parseLatteResearchItem(raw: unknown, citationsSet: Set<string>): LatteResearchItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const category = typeof obj.category === "string" ? obj.category.trim() : "other";
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const url = typeof obj.url === "string" ? obj.url.trim() : "";
  const source = typeof obj.source === "string" ? obj.source.trim() : "";
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!title || !source || !summary) return null;
  // URL is optional for some items, but if present must match a citation
  if (url) {
    if (!citationsSet.has(url)) {
      const matched = Array.from(citationsSet).some((c) => c.includes(url) || url.includes(c));
      if (!matched) {
        // Drop hallucinated URLs but keep the item without one — for Latte
        // some items (a kitchen technique) don't need a URL anyway.
      }
    }
  }
  const item: LatteResearchItem = {
    category: category as LatteResearchItem["category"],
    title,
    url: url || "",
    source,
    summary,
  };
  if (typeof obj.publishedDate === "string" && obj.publishedDate.trim() !== "") {
    item.publishedDate = obj.publishedDate.trim();
  }
  if (Array.isArray(obj.insiderDetails)) {
    item.insiderDetails = obj.insiderDetails
      .filter((d): d is string => typeof d === "string" && d.trim() !== "")
      .map((d) => d.trim());
  }
  return item;
}

async function runPerplexityResearch(opts: {
  issueDate: string;
  recentCoverStories: string[];
  recentContext?: LatteRecentContext;
  apiKey?: string;
}): Promise<{
  bundle: LatteResearch;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  citationsCount: number;
  latencyMs: number;
}> {
  const apiKey = opts.apiKey ?? process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("saturday_latte: PERPLEXITY_API_KEY missing");

  const userParts: string[] = [];
  userParts.push(`Today is ${opts.issueDate}.`);
  if (opts.recentCoverStories.length > 0) {
    userParts.push(
      `\nRECENT COVER STORIES (do NOT pick destinations or themes that overlap):\n${opts.recentCoverStories.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  if (opts.recentContext) {
    const ctx = opts.recentContext;
    const exclusions: string[] = [];
    if (ctx.cars.length > 0) exclusions.push(`- Cars recently featured: ${ctx.cars.join("; ")}`);
    if (ctx.tastingMenuTitles.length > 0)
      exclusions.push(
        `- Books/films/products recently in Tasting Menu: ${ctx.tastingMenuTitles.join("; ")}`,
      );
    if (ctx.cookingMoves.length > 0)
      exclusions.push(`- Cooking moves recently covered: ${ctx.cookingMoves.join("; ")}`);
    if (exclusions.length > 0) {
      userParts.push(
        `\nALREADY COVERED (do NOT return research items duplicating these — find genuinely different angles):\n${exclusions.join("\n")}`,
      );
    }
  }
  userParts.push(
    `\nFind 12-20 items across the five categories (destinations, products, watchReadListen, cooking, cars). Return the structured JSON specified in the system prompt. No preamble.`,
  );

  const start = Date.now();
  const response = await fetch(PERPLEXITY_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        { role: "user", content: userParts.join("\n") },
      ],
      temperature: 0,
      search_recency_filter: "month",
      return_citations: true,
    }),
  });
  const latencyMs = Date.now() - start;

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`perplexity: HTTP ${response.status} — ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as PerplexityResponse;
  const content = data.choices[0]?.message?.content;
  if (!content) throw new Error("perplexity: empty content");

  const json = extractJsonObject(content);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const citations = data.citations ?? [];
  const citationsSet = new Set(citations);

  const parseList = (key: string): LatteResearchItem[] => {
    const raw = parsed[key];
    if (!Array.isArray(raw)) return [];
    return raw
      .map((r) => parseLatteResearchItem(r, citationsSet))
      .filter((x): x is LatteResearchItem => x !== null);
  };

  const bundle: LatteResearch = {
    researchedOn: opts.issueDate,
    destinations: parseList("destinations"),
    products: parseList("products"),
    watchReadListen: parseList("watchReadListen"),
    cooking: parseList("cooking"),
    cars: parseList("cars"),
  };

  const totalItems =
    bundle.destinations.length +
    bundle.products.length +
    bundle.watchReadListen.length +
    bundle.cooking.length +
    bundle.cars.length;
  if (totalItems === 0) throw new Error("perplexity: no items returned");

  return {
    bundle,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
    costUsd: data.usage.cost?.total_cost ?? 0,
    citationsCount: citations.length,
    latencyMs,
  };
}

// ─── Writer phase via Claude ────────────────────────────────────────────────

const STRUCTURAL_INSTRUCTIONS = `

---

# OUTPUT STRUCTURE (in addition to all voice modules above)

You produce a complete Saturday Morning Latte issue as JSON. Use the research bundle below as your source material.

## STRUCTURE — 7 sections, all required:

### 1. Cover Story
A 450-650 word piece on a destination, an experience, or a discovery. Reference real places, real restaurants (by name), real prices when relevant. Use the destinations + restaurant_food + activity items from research. Voice: Mark talking on Saturday morning, NOT travel-magazine prose.

### 2. Tasting Menu (3 items)
Worth Watching, Worth Drinking, Worth Reading, Worth Listening, Worth Trying — pick three labels. Each item:
- label: e.g. "Worth Watching" or "Worth Drinking"
- title: the actual name (movie, product, book, etc.)
- url: the actual URL where the item can be found (IMDB for movies, manufacturer/Amazon for products, publisher/Amazon for books). USE A URL FROM RESEARCH IF AVAILABLE.
- body: 80-150 words. The Unexpected Variable named. An insight from the Physics/Wisdom/Insider frame.

Pull from research: products, watchReadListen, cooking.

### 3. The Host's Corner
A specific cooking technique or hosting move. Format:
- leadIn: 1-2 sentences setting up the move (one-paragraph hook)
- moveTitle: short specific title for the move (rendered as Georgia headline on dark background — keep punchy, 4-9 words)
- moveBody: 150-250 words on the technique. Physics-based insight required (why it works at the chemical/thermal level). Specific products (Lodge, dutch oven, pizza steel, etc.) when relevant.
- learnMoreUrl: optional URL to an authoritative source for the technique (Serious Eats, King Arthur Baking, NYT Cooking, etc.). Use a research URL when available.
- learnMoreLabel: optional override for the link text. Default "Learn more →" — only set if you want different text like "Read the full guide →"

### 4. The Drive
A specific car. 100-200 words.
- car: full year/make/model (e.g. "2024 Lexus LC 500")
- url: manufacturer page or Car and Driver / MotorTrend review URL for this exact model. Use a research URL when available.
- specs: "5.0L V8 • 471 HP • Naturally aspirated, 7,300 RPM redline" — three short specs separated by " • "
- body: Why this car, in Mark's voice. Include "the unexpected variable" — what the marketing misses. End with a single line of conviction.

Pull from research: cars. If no cars in research, pick from Mark's owned/known list (Porsche 911, Lexus LC 500, Audi S6, BMW M3, Lincoln Navigator, GR Corolla, etc.). Rotate across the car spectrum — don't pick another SUV if last issue was an SUV.

### 5. Sunday Prep
50-100 words on ONE concrete action for the week ahead. Practical, friend-texting tone.
- title: short subject for the action
- body: the action itself

### 6. Sunday Reset
A SECULAR quote — Parker Palmer, Marcus Aurelius, Annie Dillard, Wendell Berry, Mary Oliver, David Whyte, Pico Iyer, etc. NOT scripture. Pick one that connects to the issue's themes.
- quote: the actual quote in clean text (no surrounding quote marks — the template adds them)
- author: the actual person who said it

### 7. Sabbath
A short Bible verse + 2-3 sentence reflection.
- verse: the verse text (no surrounding quote marks — the template adds them)
- reference: "Matthew 11:28" or "Proverbs 27:23 (ESV)"
- reflection: 2-3 sentences. Reverent, NOT preachy. The verse does the heavy lifting.

The verse should relate to rest, abundance, peace, gratitude — Saturday/Sunday morning themes. Not industry-tactic themes (those are for Daily Grind).

### preheader
Gmail preview text. 60-110 chars. Extends the cover story hook.

### ps
Reply prompt. 1-2 sentences asking one specific question.

## CRITICAL CONSTRAINTS

- **Use specific real names from research.** When you cite a restaurant, use the actual research item's title. When you recommend a car, use its actual year/make/model. Generic descriptions read as content marketing.

- **The voice modules above define HOW to write.** This section defines WHAT to produce. Follow both.

- **No em dashes (—). Use commas, periods, or parentheses.** Hard rule from voice modules.

- **First-person about Mark's life is required**, not banned. Wife, four kids ages 13-20, coastal Florida salt canal, the cars Mark has owned (4 Porsches: 924/944/968/Cayenne, Audi S4/S6, BMW X3M, Lincoln Navigator). Reference these naturally.

- **No travel-magazine voice.** "A hidden gem awaits" is banned. Mark wouldn't say that.

## Cover Story Inline Hyperlinks
The published Latte hyperlinks named restaurants, hotels, and attractions in the cover story body. Include a coverStoryLinks array with text/url pairs. The renderer will find the first occurrence of each text in body paragraphs and convert it to a hyperlink. Use URLs from research items (restaurant_food, destination, activity). 3-8 links typical.

## Image Prompts — REQUIRED OUTPUT FIELD

Every issue MUST include an "imagePrompts" object at the end of your JSON with EXACTLY 7 prompts in 5 fields. These prompts will be passed to an image generation model — they are NOT optional, they are NOT examples for the writer to follow. Produce real prompts based on TODAY's actual content.

Each prompt is 15-30 words. Each must be:
- Concrete and visual (a thing in a place, not an abstract idea)
- Cinematic / editorial (warm light, documentary feel)
- Real-world identifiable scene (e.g. "Spanish moss draped over a Savannah square at low winter sun" — NOT "a beautiful Southern city")
- For products: the product in context (e.g. "wood-grilled oysters with herb butter on a black cast iron pan in a kitchen window light")

The 5 image fields (one prompt per field, tastingMenu has 3 sub-prompts):
- hero: the cover story's primary place/mood, wide framing
- coverDetail: a specific detail from the cover story (restaurant interior, marsh, doorway)
- tastingMenu: array of 3 prompts, one per tasting menu item, showing each item in context
- hostsCorner: the actual cooking technique or its result (matching this issue's moveTitle)
- theDrive: the specific car you picked, in an evocative real-world setting

DO NOT use placeholder text or bracketed templates like "[scene from cover story]". WRITE THE ACTUAL PROMPT based on the content you just produced. If your cover story is about Eureka Springs Arkansas, your hero prompt is "Quiet brick streets of historic Eureka Springs at dawn, Ozark hills in the background, autumn leaves on the sidewalk."

## OUTPUT FORMAT — return ONLY this JSON, no preamble:

{
  "coverStoryHeadline": "...",
  "preheader": "...",
  "contentType": "overlooked_destination | luxury_insider | peak_season_smart | food_first_travel | international_insider | activity_mastery | family_reality | tactical_weekend | logistics_hack | hyper_local",
  "coverStoryParagraphs": ["...", "...", "..."],
  "coverStoryLinks": [
    { "text": "Artillery Bar", "url": "https://www.artillerybar.com/" },
    { "text": "The Grey", "url": "https://thegreyrestaurant.com/" }
  ],
  "tastingMenu": [
    { "label": "Worth Watching", "title": "...", "url": "https://imdb.com/...", "body": "..." },
    { "label": "Worth Drinking", "title": "...", "url": "https://...", "body": "..." },
    { "label": "Worth Reading", "title": "...", "url": "https://...", "body": "..." }
  ],
  "hostsCorner": {
    "leadIn": "...",
    "moveTitle": "...",
    "moveBody": "...",
    "learnMoreUrl": "https://...",
    "learnMoreLabel": "Learn more →"
  },
  "theDrive": {
    "car": "2024 Lexus LC 500",
    "url": "https://www.lexus.com/models/LC",
    "specs": "5.0L V8 • 471 HP • Naturally aspirated, 7,300 RPM redline",
    "body": "..."
  },
  "sundayPrep": { "title": "...", "body": "..." },
  "sundayReset": { "quote": "...", "author": "..." },
  "sabbath": { "verse": "...", "reference": "...", "reflection": "..." },
  "ps": "...",
  "imagePrompts": {
    "hero": "REQUIRED. 15-30 words describing the cover story location and mood.",
    "coverDetail": "REQUIRED. 15-30 words describing a specific detail scene from the cover story.",
    "tastingMenu": [
      "REQUIRED. 15-30 words. Visual context for tasting menu item 1.",
      "REQUIRED. 15-30 words. Visual context for tasting menu item 2.",
      "REQUIRED. 15-30 words. Visual context for tasting menu item 3."
    ],
    "hostsCorner": "REQUIRED. 15-30 words showing the cooking technique result.",
    "theDrive": "REQUIRED. 15-30 words of the specific car in an evocative real-world setting."
  }
}

FINAL CHECK BEFORE RETURNING: Did you fill in every field in imagePrompts with an actual prompt (not the placeholder text "REQUIRED...")? If not, GO BACK and write them. The image renderer fails silently if these are missing, so the email will look broken. EVERY ISSUE NEEDS ALL 7 PROMPTS.
`;

function requireString(obj: Record<string, unknown>, key: string, ctx: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`writer: ${ctx}: missing string field "${key}"`);
  }
  return v.trim();
}

function requireObject(
  obj: Record<string, unknown>,
  key: string,
  ctx: string,
): Record<string, unknown> {
  const v = obj[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    throw new Error(`writer: ${ctx}: missing object field "${key}"`);
  }
  return v as Record<string, unknown>;
}

function requireArray(obj: Record<string, unknown>, key: string, ctx: string): unknown[] {
  const v = obj[key];
  if (!Array.isArray(v)) throw new Error(`writer: ${ctx}: missing array field "${key}"`);
  return v;
}

function stripBannedDashes(raw: string): string {
  return raw
    .replace(/\s*[—–‒]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,([A-Za-z])/g, ", $1");
}

function deepStripDashes<T>(input: T): T {
  if (typeof input === "string") return stripBannedDashes(input) as unknown as T;
  if (Array.isArray(input)) return input.map((x) => deepStripDashes(x)) as unknown as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) out[k] = deepStripDashes(v);
    return out as unknown as T;
  }
  return input;
}

function parseLatteContent(rawText: string): {
  content: SaturdayLatteContent;
  contentType: string;
  imagePrompts: LatteImagePrompts | null;
} {
  const json = extractJsonObject(rawText);
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const coverStoryHeadline = requireString(parsed, "coverStoryHeadline", "root");
  const preheader = requireString(parsed, "preheader", "root");
  const contentType =
    typeof parsed.contentType === "string" ? parsed.contentType.trim() : "overlooked_destination";

  const coverParas = requireArray(parsed, "coverStoryParagraphs", "root").map((p, i) => {
    if (typeof p !== "string" || p.trim() === "") {
      throw new Error(`writer: coverStoryParagraphs[${i}] not a non-empty string`);
    }
    return p.trim();
  });
  if (coverParas.length < 2) throw new Error("writer: coverStoryParagraphs needs at least 2 items");

  const tastingMenuRaw = requireArray(parsed, "tastingMenu", "root");
  if (tastingMenuRaw.length !== 3) {
    throw new Error(`writer: tastingMenu must have exactly 3 items, got ${tastingMenuRaw.length}`);
  }
  const tastingMenu: TastingMenuItem[] = tastingMenuRaw.map((r, i) => {
    if (!r || typeof r !== "object") throw new Error(`writer: tastingMenu[${i}] not an object`);
    const o = r as Record<string, unknown>;
    const item: TastingMenuItem = {
      label: requireString(o, "label", `tastingMenu[${i}]`),
      title: requireString(o, "title", `tastingMenu[${i}]`),
      body: requireString(o, "body", `tastingMenu[${i}]`),
    };
    if (typeof o.url === "string" && o.url.trim() !== "") item.url = o.url.trim();
    return item;
  });

  // Optional coverStoryLinks
  let coverStoryLinks: LinkInBody[] | undefined;
  if (Array.isArray(parsed.coverStoryLinks)) {
    coverStoryLinks = parsed.coverStoryLinks
      .filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && !Array.isArray(l))
      .map((l) => ({
        text: typeof l.text === "string" ? l.text.trim() : "",
        url: typeof l.url === "string" ? l.url.trim() : "",
      }))
      .filter((l) => l.text && l.url);
  }

  const hostsCornerObj = requireObject(parsed, "hostsCorner", "root");
  const theDriveObj = requireObject(parsed, "theDrive", "root");
  const sundayPrepObj = requireObject(parsed, "sundayPrep", "root");
  const sundayResetObj = requireObject(parsed, "sundayReset", "root");
  const sabbathObj = requireObject(parsed, "sabbath", "root");

  const hostsCorner: SaturdayLatteContent["hostsCorner"] = {
    leadIn: requireString(hostsCornerObj, "leadIn", "hostsCorner"),
    moveTitle: requireString(hostsCornerObj, "moveTitle", "hostsCorner"),
    moveBody: requireString(hostsCornerObj, "moveBody", "hostsCorner"),
  };
  if (typeof hostsCornerObj.learnMoreUrl === "string" && hostsCornerObj.learnMoreUrl.trim() !== "") {
    hostsCorner.learnMoreUrl = hostsCornerObj.learnMoreUrl.trim();
  }
  if (
    typeof hostsCornerObj.learnMoreLabel === "string" &&
    hostsCornerObj.learnMoreLabel.trim() !== ""
  ) {
    hostsCorner.learnMoreLabel = hostsCornerObj.learnMoreLabel.trim();
  }

  const theDrive: SaturdayLatteContent["theDrive"] = {
    car: requireString(theDriveObj, "car", "theDrive"),
    specs: requireString(theDriveObj, "specs", "theDrive"),
    body: requireString(theDriveObj, "body", "theDrive"),
  };
  if (typeof theDriveObj.url === "string" && theDriveObj.url.trim() !== "") {
    theDrive.url = theDriveObj.url.trim();
  }

  const content: SaturdayLatteContent = {
    coverStoryHeadline,
    preheader,
    coverStoryParagraphs: coverParas,
    ...(coverStoryLinks ? { coverStoryLinks } : {}),
    tastingMenu,
    hostsCorner,
    theDrive,
    sundayPrep: {
      title: requireString(sundayPrepObj, "title", "sundayPrep"),
      body: requireString(sundayPrepObj, "body", "sundayPrep"),
    },
    sundayReset: {
      quote: requireString(sundayResetObj, "quote", "sundayReset"),
      author: requireString(sundayResetObj, "author", "sundayReset"),
    },
    sabbath: {
      verse: requireString(sabbathObj, "verse", "sabbath"),
      reference: requireString(sabbathObj, "reference", "sabbath"),
      reflection: requireString(sabbathObj, "reflection", "sabbath"),
    },
    ps: requireString(parsed, "ps", "root"),
  };

  // Parse imagePrompts (optional — generator runs without them, no images)
  let imagePrompts: LatteImagePrompts | null = null;
  if (parsed.imagePrompts && typeof parsed.imagePrompts === "object" && !Array.isArray(parsed.imagePrompts)) {
    const ip = parsed.imagePrompts as Record<string, unknown>;
    const tm = Array.isArray(ip.tastingMenu)
      ? ip.tastingMenu
          .filter((s): s is string => typeof s === "string" && s.trim() !== "")
          .map((s) => s.trim())
      : [];
    if (
      typeof ip.hero === "string" &&
      typeof ip.coverDetail === "string" &&
      tm.length === 3 &&
      typeof ip.hostsCorner === "string" &&
      typeof ip.theDrive === "string"
    ) {
      imagePrompts = {
        hero: ip.hero.trim(),
        coverDetail: ip.coverDetail.trim(),
        tastingMenu: tm,
        hostsCorner: ip.hostsCorner.trim(),
        theDrive: ip.theDrive.trim(),
      };
    }
  }

  return { content, contentType, imagePrompts };
}

async function runWriterPhase(
  client: Anthropic,
  issueDate: string,
  research: LatteResearch,
  recentCoverStories: string[],
  recentContext?: LatteRecentContext,
): Promise<{
  content: SaturdayLatteContent;
  contentType: string;
  imagePrompts: LatteImagePrompts | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const parts: string[] = [];
  parts.push(`Today is ${issueDate}. Write today's Saturday Morning Latte using the research below.`);
  parts.push("\n# RESEARCH (use specific items from these arrays — real names, real places):");
  parts.push(JSON.stringify(research, null, 2));
  if (recentCoverStories.length > 0) {
    parts.push(
      `\n# RECENT COVER STORIES (do NOT pick a destination or theme that overlaps):\n${recentCoverStories.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  if (recentContext) {
    const ctx = recentContext;
    const exclusions: string[] = [];
    if (ctx.cars.length > 0)
      exclusions.push(
        `## RECENT THE DRIVE PICKS (do NOT repeat — pick a DIFFERENT car from a different category of Mark's spectrum):\n${ctx.cars.map((c) => `- ${c}`).join("\n")}`,
      );
    if (ctx.tastingMenuTitles.length > 0)
      exclusions.push(
        `## RECENT TASTING MENU PICKS (do NOT repeat books/films/products):\n${ctx.tastingMenuTitles.map((t) => `- ${t}`).join("\n")}`,
      );
    if (ctx.cookingMoves.length > 0)
      exclusions.push(
        `## RECENT HOST'S CORNER MOVES (do NOT repeat the technique):\n${ctx.cookingMoves.map((m) => `- ${m}`).join("\n")}`,
      );
    if (ctx.sundayResetAuthors.length > 0)
      exclusions.push(
        `## RECENT SUNDAY RESET AUTHORS (vary — find a different secular author):\n${ctx.sundayResetAuthors.map((a) => `- ${a}`).join("\n")}`,
      );
    if (ctx.sabbathReferences.length > 0)
      exclusions.push(
        `## RECENT SABBATH VERSES (pick a different verse):\n${ctx.sabbathReferences.map((r) => `- ${r}`).join("\n")}`,
      );
    if (exclusions.length > 0) {
      parts.push(`\n# MEMORY — recently covered items, DO NOT repeat:\n\n${exclusions.join("\n\n")}`);
    }
  }
  parts.push(`\nReturn ONLY the JSON object specified. No preamble, no markdown fences.`);

  const systemPrompt = composeWeekendWriterVoice() + STRUCTURAL_INSTRUCTIONS;

  const start = Date.now();
  const response = await client.messages.create({
    model: WRITER_MODEL,
    max_tokens: WRITER_MAX_TOKENS,
    temperature: WRITER_TEMPERATURE,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: parts.join("\n") }],
  });
  const latencyMs = Date.now() - start;

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") throw new Error("writer: no text block");

  const { content, contentType, imagePrompts } = parseLatteContent(firstBlock.text);
  const stripped = deepStripDashes(content);

  return {
    content: stripped,
    contentType,
    imagePrompts,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

// ─── Sabbath verse + Sunday Reset author swap (Haiku) ─────────────────────

const SABBATH_BAN_LIST = [
  "Matthew 11:28",
  "Matthew 7:21",
  "John 14:6",
  "John 3:16",
  "Romans 8:28",
  "Jeremiah 29:11",
  "Proverbs 3:5-6",
  "Proverbs 21:5",
  "Philippians 4:13",
];

function normalizeRef(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([a-z]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function refInList(picked: string, list: string[]): boolean {
  const norm = normalizeRef(picked);
  return list.some((r) => normalizeRef(r) === norm);
}

async function swapSabbathVerse(
  client: Anthropic,
  bannedRefs: string[],
  theme: string,
): Promise<{ verse: string; reference: string; reflection: string }> {
  const allBanned = [...new Set([...bannedRefs, ...SABBATH_BAN_LIST])];
  const response = await client.messages.create({
    model: IMAGE_PROMPT_MODEL,
    max_tokens: 800,
    temperature: 0.7,
    system: `You pick a Sabbath verse for The Saturday Morning Latte, a Saturday-morning lifestyle newsletter. The verse must relate to rest, abundance, presence, gratitude, or the small things — Saturday/Sunday morning themes, not industry tactics. The reflection is 2-3 sentences, reverent but not preachy.

BANNED VERSES (do not pick any of these):
${allBanned.map((b) => `- ${b}`).join("\n")}

Pick something different. Lean into less-cited verses: Psalms 23/65/103/126/131, Ecclesiastes 3, Isaiah 30:15, Hosea 6:3, Luke 10:42, James 1:17, Lamentations 3:22-23, Zephaniah 3:17, etc.

Return ONLY this JSON, no preamble:
{
  "verse": "the verse text in clean prose",
  "reference": "Book Chapter:Verse (Translation)",
  "reflection": "2-3 sentences, reverent not preachy"
}`,
    messages: [{ role: "user", content: `Theme for this issue: ${theme}` }],
  });
  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("sabbath_swap: no text block");
  }
  const json = extractJsonObject(firstBlock.text);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (
    typeof parsed.verse !== "string" ||
    typeof parsed.reference !== "string" ||
    typeof parsed.reflection !== "string"
  ) {
    throw new Error("sabbath_swap: incomplete output");
  }
  return {
    verse: parsed.verse.trim(),
    reference: parsed.reference.trim(),
    reflection: parsed.reflection.trim(),
  };
}

async function swapSundayResetAuthor(
  client: Anthropic,
  bannedAuthors: string[],
  theme: string,
): Promise<{ quote: string; author: string }> {
  const response = await client.messages.create({
    model: IMAGE_PROMPT_MODEL,
    max_tokens: 700,
    temperature: 0.8,
    system: `You pick a Sunday Reset quote for The Saturday Morning Latte. SECULAR authors only — Wendell Berry, Mary Oliver, Annie Dillard, Marcus Aurelius, David Whyte, Pico Iyer, Rebecca Solnit, Isak Dinesen, John O'Donohue, Antonio Machado, Anne Lamott, Robert Louis Stevenson, Henry David Thoreau, Ralph Waldo Emerson, etc.

NO Bible verses, NO religious instruction (those are in the Sabbath section).

BANNED AUTHORS (do not pick any of these — they've been used recently):
${bannedAuthors.map((b) => `- ${b}`).join("\n")}

Pick a different author with a thoughtful quote about rest, presence, small things, time, the ordinary, or work. Quote 15-40 words ideally.

Return ONLY this JSON:
{
  "quote": "the quote text (no surrounding quotes — the template adds them)",
  "author": "the author's full name"
}`,
    messages: [{ role: "user", content: `Theme for this issue: ${theme}` }],
  });
  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("sunday_reset_swap: no text block");
  }
  const json = extractJsonObject(firstBlock.text);
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (typeof parsed.quote !== "string" || typeof parsed.author !== "string") {
    throw new Error("sunday_reset_swap: incomplete output");
  }
  return { quote: parsed.quote.trim(), author: parsed.author.trim() };
}

// ─── Image prompts fallback (Haiku) ────────────────────────────────────────

const IMAGE_PROMPT_SYSTEM_PROMPT = `You produce 7 image generation prompts for a Saturday Morning Latte newsletter issue, based on the issue's content. Each prompt is 15-30 words, concrete and visual, editorial photography style.

Rules:
- NO text in the prompts (text in generated images breaks the editorial look)
- NO logos, NO people's faces
- Real-world identifiable scenes (e.g. "Spanish moss draped over a Savannah square at low winter sun" — NOT "a beautiful Southern city")
- For products: the product in context (e.g. "wood-grilled oysters with herb butter on a black cast iron pan, kitchen window light")
- Warm natural lighting, documentary feel, slightly desaturated

The 7 slots, output as JSON only:
{
  "hero": "wide atmospheric scene from the cover story location",
  "coverDetail": "specific detail from cover story (interior, doorway, marsh, etc.)",
  "tastingMenu": [
    "prompt for tasting menu item 1",
    "prompt for tasting menu item 2",
    "prompt for tasting menu item 3"
  ],
  "hostsCorner": "the cooking technique or its plated result",
  "theDrive": "the specific car in an evocative real-world setting"
}

Return ONLY the JSON. No preamble.`;

async function generateImagePromptsWithHaiku(
  client: Anthropic,
  content: SaturdayLatteContent,
): Promise<LatteImagePrompts> {
  const userPrompt = `Generate image prompts for this Saturday Morning Latte issue:

COVER STORY HEADLINE: ${content.coverStoryHeadline}
COVER STORY FIRST PARAGRAPH: ${content.coverStoryParagraphs[0] ?? ""}
COVER STORY SECOND PARAGRAPH: ${content.coverStoryParagraphs[1] ?? ""}

TASTING MENU:
${content.tastingMenu.map((t, i) => `${i + 1}. [${t.label}] ${t.title}: ${t.body.slice(0, 200)}`).join("\n")}

HOST'S CORNER:
${content.hostsCorner.moveTitle}: ${content.hostsCorner.moveBody.slice(0, 300)}

THE DRIVE:
${content.theDrive.car} — ${content.theDrive.body.slice(0, 200)}

Return ONLY the 7-field JSON specified in the system prompt.`;

  const response = await client.messages.create({
    model: IMAGE_PROMPT_MODEL,
    max_tokens: IMAGE_PROMPT_MAX_TOKENS,
    temperature: 0.3,
    system: IMAGE_PROMPT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });
  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    throw new Error("haiku image-prompts: no text block");
  }
  const json = extractJsonObject(firstBlock.text);
  const parsed = JSON.parse(json) as Record<string, unknown>;

  const tm = Array.isArray(parsed.tastingMenu)
    ? parsed.tastingMenu
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .map((s) => s.trim())
    : [];
  if (
    typeof parsed.hero !== "string" ||
    typeof parsed.coverDetail !== "string" ||
    tm.length !== 3 ||
    typeof parsed.hostsCorner !== "string" ||
    typeof parsed.theDrive !== "string"
  ) {
    throw new Error(
      `haiku image-prompts: incomplete output (tm=${tm.length}, hero=${typeof parsed.hero}, cover=${typeof parsed.coverDetail}, host=${typeof parsed.hostsCorner}, drive=${typeof parsed.theDrive})`,
    );
  }

  return {
    hero: parsed.hero.trim(),
    coverDetail: parsed.coverDetail.trim(),
    tastingMenu: tm,
    hostsCorner: parsed.hostsCorner.trim(),
    theDrive: parsed.theDrive.trim(),
  };
}

// ─── Public ────────────────────────────────────────────────────────────────

export type SaturdayLatteIssue = {
  content: SaturdayLatteContent;
  contentType: string;
  research: LatteResearch;
  meta: {
    model: string;
    researchInputTokens: number;
    researchOutputTokens: number;
    researchCostUsd: number;
    researchCitations: number;
    writerInputTokens: number;
    writerOutputTokens: number;
    imagesCostUsd: number;
    imagesLatencyMs: number;
    imagesGenerated: number;
    imagesFailed: number;
    imagePromptsSource?: "writer" | "haiku" | "none";
    imagePromptsError?: string;
    imagesError?: string;
    urlsValidated: number;
    urlsDropped: number;
    totalCostUsd: number;
    researchLatencyMs: number;
    writerLatencyMs: number;
    issueDate: string;
  };
};

export type LatteRecentContext = {
  coverStoryHeadlines: string[];
  cars: string[];
  tastingMenuTitles: string[];
  cookingMoves: string[];
  sundayResetAuthors: string[];
  sabbathReferences: string[];
};

export async function generateSaturdayLatteIssue(opts: {
  issueDate: string;
  recentCoverStories?: string[];
  recentContext?: LatteRecentContext;
  anthropicApiKey?: string;
  perplexityApiKey?: string;
}): Promise<SaturdayLatteIssue> {
  const anthropicKey = opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY missing");
  const client = new Anthropic({ apiKey: anthropicKey });
  const recentCoverStories = opts.recentCoverStories ?? [];
  const recentContext = opts.recentContext;

  const research = await runPerplexityResearch(
    opts.perplexityApiKey
      ? {
          issueDate: opts.issueDate,
          recentCoverStories,
          apiKey: opts.perplexityApiKey,
          ...(recentContext ? { recentContext } : {}),
        }
      : { issueDate: opts.issueDate, recentCoverStories, ...(recentContext ? { recentContext } : {}) },
  );
  const writer = await runWriterPhase(
    client,
    opts.issueDate,
    research.bundle,
    recentCoverStories,
    recentContext,
  );

  const writerCost =
    (writer.inputTokens / 1_000_000) * ANTHROPIC_INPUT_PER_M +
    (writer.outputTokens / 1_000_000) * ANTHROPIC_OUTPUT_PER_M;

  // Image generation phase: fire 7 DALL-E 3 calls in parallel, upload to
  // Supabase Storage. Best-effort — if any fail, the email still renders
  // (the template handles missing image slots gracefully).
  let imagesCostUsd = 0;
  let imagesLatencyMs = 0;
  let imagesGenerated = 0;
  let imagesFailed = 0;
  let imagesError: string | null = null;
  let contentWithImages = writer.content;

  // Image prompts: try the writer's output first, fall back to a focused
  // Haiku call if the writer skipped them.
  let imagePrompts = writer.imagePrompts;
  let imagePromptsSource: "writer" | "haiku" | "none" = imagePrompts ? "writer" : "none";
  let imagePromptsError: string | null = null;
  if (!imagePrompts) {
    try {
      imagePrompts = await generateImagePromptsWithHaiku(client, writer.content);
      imagePromptsSource = "haiku";
    } catch (err) {
      imagePromptsError = err instanceof Error ? err.message : String(err);
      console.error("latte.image_prompts_haiku_failed", imagePromptsError);
    }
  }

  // URL validation: drop any URLs that aren't research-cited and don't pass
  // an HTTP HEAD check. Runs in parallel with image gen since they don't
  // interact.
  const allResearchUrls = [
    ...research.bundle.destinations.map((r) => r.url),
    ...research.bundle.products.map((r) => r.url),
    ...research.bundle.watchReadListen.map((r) => r.url),
    ...research.bundle.cooking.map((r) => r.url),
    ...research.bundle.cars.map((r) => r.url),
  ].filter((u) => u && u.trim() !== "");

  const urlValidationPromise = validateContentUrls(writer.content, allResearchUrls);

  if (imagePrompts) {
    try {
      const imageResult = await generateLatteImages({
        prompts: imagePrompts,
        issueDate: opts.issueDate,
      });
      imagesCostUsd = imageResult.costUsd;
      imagesLatencyMs = imageResult.latencyMs;
      imagesFailed = imageResult.failures.length;
      // Count successes by counting set keys in urls (tasting menu counted per slot)
      const tmCount = imageResult.urls.tastingMenu
        ? imageResult.urls.tastingMenu.filter((u) => u && u.trim() !== "").length
        : 0;
      const otherCount = [
        imageResult.urls.hero,
        imageResult.urls.coverDetail,
        imageResult.urls.hostsCorner,
        imageResult.urls.theDrive,
      ].filter((u) => u && u.trim() !== "").length;
      imagesGenerated = tmCount + otherCount;
      contentWithImages = { ...writer.content, images: imageResult.urls };
    } catch (err) {
      // Image generation failed entirely — log but don't fail the issue
      imagesError = err instanceof Error ? err.message : String(err);
      console.error("latte.image_generation_failed", imagesError);
    }
  }

  // Apply URL validation results (await the parallel job we kicked off above)
  const urlValidation = await urlValidationPromise;
  // Merge images into the validated content so we keep both transformations
  contentWithImages = {
    ...urlValidation.content,
    ...(contentWithImages.images ? { images: contentWithImages.images } : {}),
  };

  // Enforce Sabbath verse + Sunday Reset author memory via Haiku swaps.
  // Writer prompt asks for variety but Claude defaults to Matthew 11:28
  // and a few rotating authors regardless. Code-level check + swap.
  const recentSabbathRefs = recentContext?.sabbathReferences ?? [];
  const recentAuthors = recentContext?.sundayResetAuthors ?? [];
  if (
    refInList(contentWithImages.sabbath.reference, recentSabbathRefs) ||
    refInList(contentWithImages.sabbath.reference, SABBATH_BAN_LIST)
  ) {
    try {
      const newSabbath = await swapSabbathVerse(
        client,
        recentSabbathRefs,
        contentWithImages.coverStoryHeadline,
      );
      contentWithImages = { ...contentWithImages, sabbath: newSabbath };
    } catch (err) {
      console.error(
        "latte.sabbath_swap_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  if (recentAuthors.includes(contentWithImages.sundayReset.author)) {
    try {
      const newReset = await swapSundayResetAuthor(
        client,
        recentAuthors,
        contentWithImages.coverStoryHeadline,
      );
      contentWithImages = { ...contentWithImages, sundayReset: newReset };
    } catch (err) {
      console.error(
        "latte.sunday_reset_swap_failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    content: contentWithImages,
    contentType: writer.contentType,
    research: research.bundle,
    meta: {
      model: WRITER_MODEL,
      researchInputTokens: research.inputTokens,
      researchOutputTokens: research.outputTokens,
      researchCostUsd: research.costUsd,
      researchCitations: research.citationsCount,
      writerInputTokens: writer.inputTokens,
      writerOutputTokens: writer.outputTokens,
      imagesCostUsd,
      imagesLatencyMs,
      imagesGenerated,
      imagesFailed,
      imagePromptsSource,
      ...(imagePromptsError ? { imagePromptsError } : {}),
      ...(imagesError ? { imagesError } : {}),
      urlsValidated: urlValidation.validated,
      urlsDropped: urlValidation.dropped,
      totalCostUsd: research.costUsd + writerCost + imagesCostUsd,
      researchLatencyMs: research.latencyMs,
      writerLatencyMs: writer.latencyMs,
      issueDate: opts.issueDate,
    },
  };
}
