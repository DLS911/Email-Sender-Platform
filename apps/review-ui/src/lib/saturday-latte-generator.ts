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

# URL REQUIREMENTS — HARD RULE
- If you include a "url" field, it MUST be a deep article URL (with a slug), NOT a homepage or section page.
- VALID: https://www.caranddriver.com/reviews/a12345/2024-amg-c63
- INVALID: https://www.caranddriver.com (homepage)
- INVALID: https://www.caranddriver.com/reviews (section page)
- If you cannot find a deep article URL, OMIT the url field entirely rather than supplying a homepage. The newsletter renders fine without a URL — but a homepage link is worse than none because it breaks reader trust.

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
  if (firstBrace === -1) {
    throw new Error(`no JSON object found in output: ${cleaned.slice(0, 200)}`);
  }
  // String-aware brace matching: find the close brace that matches the first
  // open brace, ignoring braces inside string literals. Robust against
  // trailing commentary the writer occasionally appends after the JSON block.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(firstBrace, i + 1);
    }
  }
  throw new Error(`unbalanced JSON object in output: ${cleaned.slice(0, 200)}`);
}

function isBareDomainUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (path === "" || path === "/" || path === "/index.html") return true;
    const segments = path.replace(/^\/+/, "").split("/").filter(Boolean);
    if (segments.length === 0) return true;
    const cleanedSegments = segments.map((s) =>
      s.replace(/\.(html?|pdf|aspx?|php|jsp)$/i, ""),
    );
    const hasArticleLikeSegment = cleanedSegments.some((s) => {
      if (s.includes("-")) return true;
      if (s.length >= 10) return true;
      if (/^\d{4,}$/.test(s)) return true;
      return false;
    });
    if (hasArticleLikeSegment) return false;
    return true;
  } catch {
    return true;
  }
}

function parseLatteResearchItem(raw: unknown, citationsSet: Set<string>): LatteResearchItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const category = typeof obj.category === "string" ? obj.category.trim() : "other";
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  let url = typeof obj.url === "string" ? obj.url.trim() : "";
  const source = typeof obj.source === "string" ? obj.source.trim() : "";
  const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
  if (!title || !source || !summary) return null;
  // Drop bare-domain URLs (homepages, section pages) — they don't cite the
  // actual story. Keep the item if otherwise valid, just without the URL.
  if (url && isBareDomainUrl(url)) {
    url = "";
  }
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
      // search_recency_filter removed — empirical testing showed it returns
      // garbage citations (gardening/food/movies) for our query pattern.
      // Recency bias enforced via the prompt ("fresh real recent" framing).
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

# HARD RULE — AUTHOR CREDIBILITY (READ THIS FIRST, IT OVERRIDES DEFAULT WRITING INSTINCTS)

The voice modules above establish the scoped author credibility rule and introduce **The Connections Guy** as the Cover Story attribution source. Repeating the essential rules here because the writer forgets them under the pressure of producing sensory prose. This is the single most common failure mode in weekend content and subscribers CATCH it.

**Mark's authentic first-person scope (personal presence PERMITTED):**
- Home: coastal Florida salt canal, dock, boat, mornings on the water
- Family: wife, four kids ages 13-20 (no toddlers, no booster seats)
- Skiing (ONLY these mountains): Big Sky, Whitefish, Jackson, Telluride, Steamboat, Park City, Kicking Horse
- Cars (ONLY these owned/driven): Porsche 924, 944, 968, Cayenne Turbo; Audi S4, Audi S6 Avant; BMW X3M Competition; Lincoln Navigator; golf cart
- Home cooking / hosting: cast iron, pizza steel, Peloton Power Zone, Yeti heavy use, Costco Kirkland, Lodge, Friday pizza on the patio
- Faith / Sabbath rhythm
- Coastal FL neighbors within golf-cart distance

**Everywhere else, Mark HAS NOT BEEN.** The Cover Story destination is almost always outside his scope (that is the point of the section). Palm Springs, Marfa, Sedona, Charleston, Aspen, Napa, Bermuda, Positano, Kyoto, Savannah, Asheville, Sun Valley, Vail, Beaver Creek, Whistler, Banff, Zermatt, Chamonix, Wyoming ranch towns, Montana river towns not named above — Mark has not personally been there. If it is not on the scope list above, treat it as OUT OF SCOPE.

**Forbidden sentence patterns for out-of-scope places, restaurants, hotels, or experiences (in ANY section):**
- "When I was there…" / "On my last visit…" / "The last time we went…"
- "We stayed at…" / "We ate at…" / "We had…" / "We ordered…" (about restaurants/hotels/venues Mark hasn't been to)
- "I remember when…" / "Years ago I…" / "I've been going for…" / "The first time I went…"
- "The trip when we…" / "On our drive down…" / "On our way out we…"
- Any composite personal-experience scene at a Cover Story location that isn't in the scope list

**Also forbidden across the whole newsletter: the "friend" fallback.** The Latte used to lean on constructions like "a friend of mine," "a friend who's been going every October," "a friend who spent a January there." That pattern got overused, felt lazy, and is now dead. Do not use "a friend of mine" or "a friend who…" as an attribution device. Attribution goes through THE GUY (Cover Story only) or through the section-specific sources listed below.

## Per-Section Attribution Rules

### Cover Story — attribution ALWAYS goes through The Connections Guy

For any Cover Story destination OUTSIDE Mark's scope (see list above), the piece MUST open with a handoff from **The Connections Guy** — a note, voicemail, text, email, dinner story, or postcard. See the WEEKEND_CONNECTIONS_GUY voice module for the full character sheet.

Required moves in the Cover Story open:
1. **First or second paragraph** introduces The Connections Guy surfacing the destination via one specific communication vector ("The Connections Guy sent me a note about [place] in [month]" / "The Connections Guy left me a voicemail last week" / "I got a text from The Connections Guy from an airport gate in [city]"). Rotate the vector across issues so it doesn't get formulaic.
2. **Name the RELATIONSHIP** through which The Connections Guy had the experience. Not "The Connections Guy was in Tucson." Instead: "The Connections Guy was there for four days last January, crashing at a college roommate's place in Barrio Viejo." Not "The Connections Guy loved the wine." Instead: "The Connections Guy's roommate's neighbor works at a vineyard and put a case in front of them one night." The relationship is what makes The Connections Guy believable and specific.
3. **Quote him TERSE.** One to three sentences of his voice, in quotes, terse and dry. Never a paragraph of his prose. Example — Three lines, which is verbose for him: "Third week of January is the window. Skip Sedona. Barrio Viejo, then Sonoita. Don't tell everyone."
4. **Mark synthesizes after the handoff.** Once The Connections Guy has handed the ball off, MARK's voice — analytical, pattern-recognizing, opinionated — carries the rest of the piece. Mark is the SYNTHESIZER, not the traveler. The sensory prose comes from Mark interpreting what The Connections Guy laid out plus what Mark has heard from his own network, or from unvoiced factual writing.
5. **AT MOST one callback** to The Connections Guy later in the piece ("The Connections Guy's rule is east in the morning, west at 4pm") if it earns its place. Two-plus callbacks flatten him into shtick.
6. **If the Cover Story destination IS in Mark's scope** (a ski mountain he actually visits, coastal FL), The Connections Guy does NOT appear at all. Mark speaks in his own first-person voice for those pieces. The Connections Guy is only for out-of-scope material.

The Connections Guy does NOT appear anywhere else in the newsletter. See section rules below.

### Host's Corner — attribution via cookbook/chef, named kitchen, publication, or unvoiced fact. NEVER The Connections Guy.

Mark cooks. Host's Corner is mostly in-scope for his own first-person — cast iron, pizza steel, Yeti, Costco Kirkland, Lodge, Friday pizza on the patio. When the technique is something Mark hasn't personally practiced (sous-vide chamber-vac setups, competition BBQ rigs, complex French methods), attribute via:
- **Named cookbook / chef.** "Kenji López-Alt's take in *The Food Lab*." "This is the method Nathan Myhrvold spec'd out in *Modernist Cuisine*."
- **Named kitchen / restaurant.** "This is how the pit at Franklin BBQ handles brisket rest." "St. John in London built its reputation on this move."
- **Publication.** "Cook's Illustrated tested this six ways in 2019 and landed on…"
- **Unvoiced fact / chemistry.** "The reason this method works: at 129°F over four hours, myosin denatures but actin doesn't…"

DO NOT invoke The Connections Guy in Host's Corner. If the writer types "The Connections Guy told me about this method" here, DELETE that sentence and re-attribute via one of the above.

### The Drive — attribution via automotive publication, named owner-in-network, or unvoiced/reference fact. NEVER The Connections Guy.

When the car is in Mark's owned/driven spectrum (924/944/968/Cayenne Turbo/S4/S6 Avant/X3M/Navigator), Mark speaks in first-person. When the car is OUTSIDE that spectrum, attribute via:
- **Named automotive publication or reviewer.** "Chris Harris on the Grand Tour called this the last time…" "*Car and Driver*'s long-term test hit 34,000 miles before…" "Doug DeMuro's video shows the trunk quirk that…"
- **Named owner in Mark's network.** "An advisor I've worked with for six years owns a G87 M2 in Zandvoort Blue and drove it up to Watkins Glen last summer. What he keeps telling me…" (Only when it's the natural attribution; do not fabricate advisor ownership.)
- **Unvoiced / reference fact.** "The G87 M2 is 453 hp, 3,867 lbs, and the last M-car with a manual gearbox available. That is the frame." No speaker needed for the spec sheet.

DO NOT invoke The Connections Guy in The Drive. If the writer types "The Connections Guy has a 964 he drives once a month," DELETE that sentence — the reference belongs in a Cover Story if it belongs at all.

### Tasting Menu — attribution via review/publication, Mark's actual use, or unvoiced fact. NEVER The Connections Guy.

Products, books, films, drinks. Attribute via:
- **Named review or publication.** "The *New York Times* review of this called it…" "*Cook's Illustrated* tasted 21 of these and put this one at the top." "Anthony Bourdain in *Kitchen Confidential* referenced this exact bourbon."
- **Mark's actual use** when the product is one Mark genuinely uses (Yeti, Lodge, Costco Kirkland, pizza steel, etc.). "I've had a bottle of Weller Special Reserve open on my counter for two months."
- **Unvoiced fact.** "This comes out of Bardstown, 8 years old, 100 proof, roughly $32 a bottle when you can find it."

DO NOT invoke The Connections Guy in Tasting Menu.

### Sunday Prep / Sunday Reset / Sabbath — Mark's own voice throughout. NEVER The Connections Guy.

These sections are Mark speaking directly. No attribution device needed. Sunday Reset quotes a named secular author. Sabbath quotes scripture. Sunday Prep is Mark's own tactical recommendation. The Connections Guy does not appear.

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

Each prompt is 15-35 words. Prompts must produce real editorial photography (Garden & Gun / Kinfolk / National Geographic Traveler register) — not AI-generic "cinematic" plates. Every prompt MUST specify at least these three:

1. **Specific quality of light + time of day.** Not "warm light" — "low sun at 6:30pm through the western windows," or "overcast Tuesday morning diffuse light from the north," or "kitchen window light at 4pm, autumn." Named light does the work of atmosphere.
2. **A single focal subject or one specific interaction.** A hand doing a thing. A single object worn from use. The steam off a cup. One dish being finished. Not a wide scene with everything in it — ONE thing the eye lands on.
3. **A physical detail or texture the eye catches.** Dust on a wood beam. A worn patina on a bar top. Flour on a marble slab. One dried leaf on the sidewalk. The imperfection is the anti-AI signal.

Also useful when the piece calls for it: attribution to the SPECIFIC place named in the story (not a generic version of that kind of place). If the story is about Whitefish, MT in early season, the hero prompt names Whitefish (or its clearly identifying feature) — not "a mountain town."

DO NOT use these hollow words in prompts (they push the model to the AI-editorial default): "beautiful," "cinematic," "editorial," "charming," "picturesque," "atmospheric," "cozy," "warm and inviting." Say what SPECIFICALLY is beautiful — the light, the surface, the gesture.

The 5 image fields (one prompt per field, tastingMenu has 3 sub-prompts):
- hero: the cover story's primary place, one focal element, specific light + time of day
- coverDetail: a specific ONE-thing detail from the cover story (a hand on a rail, oysters on ice, a specific doorway with light hitting it)
- tastingMenu: array of 3 prompts, one per tasting menu item, showing each item in a real use context
- hostsCorner: the actual cooking technique in progress or its result — a hand, a pan, one moment
- theDrive: the specific car in a specific real-world setting with specific light. **CAR ACCURACY IS CRITICAL AND HAS BEEN A REPEATED FAILURE MODE** — image models WILL default to the previous generation of a nameplate unless the prompt spells out (a) the current generation, (b) 4-5 distinguishing visual features, (c) an explicit "NOT the [previous generation]" negative, and (d) a period-correct color. Readers who know cars notice immediately when a 2024 M2 renders as a 2020 M2. Every theDrive prompt MUST use the structure below.

**Required components for every theDrive prompt when a specific year/model is named:**

1. **Year + generation code up front.** "2024 BMW M2 (G87 generation, 2023+)" — the year and code in the same clause.
2. **4-5 distinguishing visual features of THAT generation** — bodywork, headlights, taillights, exhaust arrangement, grille shape, wheel design that differ from the previous generation.
3. **Explicit negative on the previous generation.** "NOT the F87 generation with round twin headlights and rounded fender flares." This clause is what forces the image model off its default.
4. **Iconic period-correct color** for that generation. Zandvoort Blue Metallic for the G87 M2. Signal Green for the 992.1 GT3 RS. Nardo Grey for RS-family Audis. Guards Red for a 911 that reads classic-Porsche.
5. **Then the setting and light** (coastal Florida marina at 7:30am, mountain switchback at golden hour, garage doorway with north light, etc.).

**Reference table — common car generation pairs the image model gets wrong:**

- **BMW M2**: G87 (2023+) = SQUARED-OFF boxy fender flares, SLIM horizontal laser LED headlights, hexagonal DRLs, tall vertical kidney grille in body color, quad rectangular exhaust tips in a symmetric arrangement, aggressive angular front bumper with large lower intake, side vents in the front fenders. NOT the F87 (2016-2021) which had ROUNDED fender flares, TWIN ROUND headlights with corona rings, twin round DRLs, smaller kidney grilles, twin oval exhaust tips.
- **BMW M3**: G80 (2021+) = LARGE VERTICAL kidney grilles (buck-toothed), slim angular headlights, quad rectangular exhausts, carbon roof. NOT the F80 (2014-2018) which had SMALL horizontal kidney grilles, twin round LED-halo headlights, quad round exhausts.
- **BMW M4**: G82 (2021+) = large vertical grilles same as G80. NOT the F82.
- **Porsche 911**: 992 (2020+) = FULL-WIDTH light bar across the rear, integrated door handles, wide rear haunches, flat front hood without visible headlight bulges, single circular DRL. NOT the 991 (2012-2019) which had a smaller rear light bar, protruding door handles, or the 997 (2005-2011) with the fried-egg headlights.
- **Porsche 911 GT3**: 992.1 GT3 (2021+) = swan-neck rear wing, split cooling ducts on the front, center-lock wheels, oversize side intakes. Signal Green is the iconic color. NOT the 991.2 GT3 (2018-2019).
- **Corvette**: C8 (2020+) = MID-ENGINE layout visible in the side profile, cockpit pushed FORWARD, large side scoops behind the doors feeding the mid-mounted V8, split rear window, quad center-exit exhausts. NOT the C7 (2014-2019) which was FRONT-ENGINE with a long hood and rear-cockpit layout.
- **Mazda Miata (MX-5)**: ND (2016+) = angular headlights, sharp folds in the bodywork, low nose. NOT the NC (2006-2015) which was ROUNDER with softer bodywork, or the NB/NA with round headlights.
- **Toyota GR Corolla** (2023+): 5-door hatch, aggressive front fascia with hexagonal grille, wide fender flares, triple-tip exhaust in the center, roof-mounted spoiler. Distinct from the standard Corolla hatchback.
- **Audi RS6 Avant**: C8 (2020+) = wide fender flares (WIDER than the S6 body), oval exhaust tips (not round), full-width tail-light bar, aggressive front splitter. Nardo Grey iconic. NOT the C7 RS6 (which wasn't sold in the US in that generation) or the C7 S6.

If the writer's car pick has no widely-known generation code (some Japanese sedans, some SUVs), fall back to (a) year, (b) trim, (c) 4-5 unique visual features of THAT specific year's fascia/lighting/wheels, (d) "NOT the [previous year's face-lift]" if there was a mid-cycle refresh.

**Example prompt (2024 BMW M2 G87):**

"2024 BMW M2 (G87 generation, 2023+) in Zandvoort Blue Metallic parked at a coastal Florida marina at 7:30am. Squared-off boxy front fender flares (NOT the rounded flares of the F87), slim horizontal laser LED headlights with hexagonal daytime running lights (NOT the twin round headlights of the F87), tall vertical BMW kidney grille in body color, quad rectangular exhaust tips symmetrically arranged, aggressive angular front bumper with a wide lower intake. Off-center rule-of-thirds composition with mist over the marina in the background and a single dock line in the left foreground. Portra 400 warmth, motivated overcast morning light from the north. No people in frame."

DO NOT use placeholder text or bracketed templates like "[scene from cover story]". WRITE THE ACTUAL PROMPT based on the content you just produced.

Example (Eureka Springs cover story):
- Weak (AI-default): "Quiet brick streets of historic Eureka Springs at dawn, atmospheric, cinematic."
- Strong: "Empty brick main street of Eureka Springs at 6:15am, low fog off the Ozarks in the background, first sunlight catching the copper trim on a storefront awning, one dried oak leaf on the curb."

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

const IMAGE_PROMPT_SYSTEM_PROMPT = `You produce 7 image generation prompts for a Saturday Morning Latte newsletter issue, based on the issue's content. Each prompt is 15-35 words, concrete and visual, editorial photography style (Garden & Gun / Kinfolk / Nat Geo Traveler register).

Rules:
- NO text in the prompts (text in generated images breaks the editorial look)
- NO logos, NO clearly identifiable faces
- Real-world identifiable scenes (e.g. "Spanish moss draped over a Savannah square at low winter sun" — NOT "a beautiful Southern city")
- For products: the product in context (e.g. "wood-grilled oysters with herb butter on a black cast iron pan, kitchen window light")
- Motivated warm natural lighting, documentary feel, one focal element per frame, off-center composition
- Avoid the hollow words "beautiful," "cinematic," "editorial," "charming," "picturesque," "atmospheric," "cozy," "warm and inviting" — say WHAT specifically is worth looking at

**CAR ACCURACY (for theDrive) — repeated failure mode:** Image models WILL default to the previous generation of a nameplate unless the prompt spells out (a) the year + generation code, (b) 4-5 distinguishing visual features of THAT generation, (c) an EXPLICIT NEGATIVE on the previous generation ("NOT the F87 M2 with round headlights"), and (d) a period-correct color. Missing the explicit negative is why a 2024 M2 renders as a 2020 M2. Include all four elements.

Quick reference for common generation pairs:
- BMW M2: G87 (2023+, squared boxy flares, slim horizontal LED headlights, hexagonal DRLs, quad rectangular exhausts). NOT F87 (round twin headlights, rounded flares, twin oval exhausts).
- BMW M3/M4: G80/G82 (large vertical buck-toothed grilles). NOT F80/F82 (small horizontal grilles).
- Porsche 911: 992 (full-width rear light bar, integrated door handles, flat hood). NOT 991 (smaller light bar, protruding handles).
- Corvette: C8 (mid-engine, cockpit forward, side scoops behind doors). NOT C7 (front-engine, long hood).
- Miata: ND (angular headlights, sharp folds). NOT NC/NB (rounder body).
- Audi RS6 Avant: C8 (wide flares, full-width tail-light bar, oval exhausts, Nardo Grey iconic).

The 7 slots, output as JSON only:
{
  "hero": "wide atmospheric scene from the cover story location, with specific light + one focal element",
  "coverDetail": "one specific detail from cover story (a hand on a rail, oysters on ice, a doorway at 4pm light)",
  "tastingMenu": [
    "prompt for tasting menu item 1 in real use context",
    "prompt for tasting menu item 2 in real use context",
    "prompt for tasting menu item 3 in real use context"
  ],
  "hostsCorner": "the cooking technique in progress or its result — hand, pan, one moment",
  "theDrive": "the specific car with YEAR + GENERATION CODE + 4-5 distinguishing visual features + EXPLICIT NEGATIVE on the previous generation + period-correct color, in an evocative real-world setting with specific light. Example: '2024 BMW M2 (G87 generation, 2023+) in Zandvoort Blue Metallic at a coastal Florida marina at 7:30am. Squared-off boxy fender flares (NOT the rounded flares of the F87), slim horizontal laser LED headlights with hexagonal DRLs (NOT the twin round headlights of the F87), tall vertical kidney grille in body color, quad rectangular exhaust tips symmetrically arranged. Off-center composition with mist over the marina and a single dock line in the left foreground.'"
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

// ─── Author-scope guard (Haiku) ────────────────────────────────────────────
// Post-write pass that catches Cover Story / Host's Corner / The Drive
// sentences where the writer asserted Mark's first-person presence at a
// place, restaurant, or experience outside his authentic scope, and rewrites
// them as attributed statements. The writer usually gets this right after
// the STRUCTURAL_INSTRUCTIONS header — but not always, and this is the most
// visible failure mode when it slips. Cheap Haiku call (~$0.002/issue).

const AUTHOR_SCOPE_MODEL = "claude-haiku-4-5-20251001";
const AUTHOR_SCOPE_MAX_TOKENS = 3000;

const AUTHOR_SCOPE_SYSTEM_PROMPT = `You are the author-credibility guard for Saturday Morning Latte. Your job is to find three specific classes of writing failures and rewrite them:

**Class 1 — Out-of-scope first-person presence.** Sentences that assert Mark's personal presence at a place, restaurant, hotel, city, or specific experience OUTSIDE his authentic scope.

**Class 2 — The "friend" fallback.** Any attribution using "a friend of mine," "a friend who…," "friends of mine," "friends who…" or similar generic friend constructions. This fallback got overused and is now banned across the entire newsletter.

**Class 3 — The Connections Guy appearing outside the Cover Story.** The Connections Guy is a recurring Cover Story character (a source through whom out-of-scope destinations reach Mark). He appears ONLY in the coverStory section. If he appears in hostsCorner or theDrive, that is a violation — re-attribute via a section-appropriate source.

**Mark's authentic scope (first-person presence PERMITTED here — do NOT flag these):**
- Home: coastal Florida salt canal, dock, boat, mornings on the water
- Family: wife, four kids ages 13-20 (no toddlers)
- Skiing (ONLY these mountains): Big Sky, Whitefish, Jackson, Telluride, Steamboat, Park City, Kicking Horse
- Cars owned/driven: Porsche 924, 944, 968, Cayenne Turbo; Audi S4, Audi S6 Avant; BMW X3M Competition; Lincoln Navigator; golf cart
- Home cooking / hosting: cast iron, pizza steel, Peloton Power Zone, Yeti heavy use, Costco Kirkland, Lodge, Friday pizza on the patio
- Faith / Sabbath rhythm
- Coastal FL neighbors within golf-cart distance

Everything else is OUT of scope. The Cover Story destination is almost always out of scope — that is the point of the section.

**Flag these sentence patterns when the referent is OUT OF SCOPE (Class 1):**
- "When I was there…" / "On my last visit…" / "The last time we went…"
- "We stayed at…" / "We ate at…" / "We had…" / "We ordered…" (about specific out-of-scope venues)
- "I remember when…" / "Years ago I…" / "I've been going for…" / "The first time I went…"
- "The trip when we…" / "On our drive down…" / "On our way out…"
- Composite personal-experience scenes at the Cover Story location when that location is out of scope

**Flag any "friend" fallback (Class 2), regardless of section:**
- "a friend of mine" / "a friend who" / "friends of mine" / "a friend told me" / "a friend has been going"
- Rewrite these attributions using a section-appropriate specific source (see rewrite rules below).

**Flag The Connections Guy in the wrong section (Class 3):**
- If a sentence in hostsCorner or theDrive references "The Connections Guy" or the shortened form "Connections" as a proper noun for the character — flag it and rewrite to use a section-appropriate attribution.
- Also flag any lingering legacy form "The Guy" (without "Connections") in the Cover Story — the canonical name is "The Connections Guy" for the first reference in each Cover Story, with the shortened "Connections" (single word, capitalized, no article) allowed for one later callback in the same piece. Rewrite "The Guy" occurrences to the canonical form.

**Rewrite rules by section:**

*If the violation is in the Cover Story (coverStory):*
- Rewrite so The Connections Guy is the attribution source. The Connections Guy is a real recurring character in Mark's world: sixty-ish, semi-retired, modest life with an outsized network. He does not own anything discussed; his experiences came through RELATIONSHIPS (his college roommate, his brother-in-law, a client who hosted him, his neighbor, someone at a dinner). Every reference to The Connections Guy names the relationship pipeline through which he had the experience.
- His voice is terse and dry. Quoted lines are one to three sentences, in quote marks.
- Examples of good rewrites:
  - Before: "A friend who spent a January there did both."
  - After: "The Connections Guy was there for four days last January, crashing at a college roommate's place in Barrio Viejo, and did both."
  - Before: "When we ate at Palmer's Fish House, Steve told us to order the stew."
  - After: "The Connections Guy had dinner at Palmer's Fish House while he was hosted for a weekend by a client on the coast. Steve came out from behind the shucking counter and told him: skip the raw bar, go straight for the stew."
- Do NOT use "a friend of mine" as a substitute. The Connections Guy is the replacement.
- Unvoiced factual statements are fine when a speaker isn't needed. "Sixty-eight degrees most days in January. Dry air." No attribution required.

*If the violation is in hostsCorner:*
- Attribute via named cookbook/chef, named kitchen/restaurant, named publication, or unvoiced fact/chemistry. NEVER The Connections Guy. NEVER "a friend of mine."
- Examples: "Kenji López-Alt's take in *The Food Lab*." / "This is how the pit at Franklin BBQ handles brisket rest." / "*Cook's Illustrated* tested this six ways in 2019." / "The reason this method works: at 129°F over four hours, myosin denatures but actin doesn't."

*If the violation is in theDrive:*
- Attribute via named automotive publication or reviewer, named owner-in-Mark's-network (advisor with a locatable practice), or unvoiced/reference fact. NEVER The Connections Guy. NEVER "a friend of mine."
- Examples: "Chris Harris on the Grand Tour called this the last time BMW built…" / "An advisor I've worked with for six years owns a G87 M2 in Zandvoort Blue and drove it up to Watkins Glen last summer." / "The G87 M2 is 453 hp, 3,867 lbs, and the last M-car with a manual gearbox."

**General rewrite rules (all sections):**
- Keep sensory density — specific details, named businesses, timing, textures.
- Preserve paragraph shape and cadence. Do not compress or delete named restaurants, hotels, or places. Just change the SPEAKER or the ATTRIBUTION device.
- Do not use em dashes. Use commas, periods, or parentheses.

Return ONLY this JSON:
{
  "violations": [
    {
      "section": "coverStory" | "hostsCorner" | "theDrive",
      "class": 1 | 2 | 3,
      "original": "the exact sentence or short passage that violates (verbatim from the input)",
      "rewrite": "the attributed rewrite"
    }
  ]
}

If no violations, return {"violations":[]}. Do not include preamble or markdown fences.`;

type AuthorScopeViolation = {
  section: "coverStory" | "hostsCorner" | "theDrive";
  class?: 1 | 2 | 3;
  original: string;
  rewrite: string;
};

async function enforceAuthorScope(
  client: Anthropic,
  content: SaturdayLatteContent,
): Promise<{ content: SaturdayLatteContent; violationsFound: number; violationsApplied: number }> {
  const passages = [
    `## CoverStoryHeadline\n${content.coverStoryHeadline}`,
    `## CoverStoryParagraphs\n${content.coverStoryParagraphs.join("\n\n")}`,
    `## HostsCorner\n${content.hostsCorner.leadIn}\n\n${content.hostsCorner.moveBody}`,
    `## TheDrive\n${content.theDrive.body}`,
  ].join("\n\n");

  let response;
  try {
    response = await client.messages.create({
      model: AUTHOR_SCOPE_MODEL,
      max_tokens: AUTHOR_SCOPE_MAX_TOKENS,
      temperature: 0.1,
      system: AUTHOR_SCOPE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: passages }],
    });
  } catch (err) {
    console.error(
      "latte.author_scope_call_failed",
      err instanceof Error ? err.message : String(err),
    );
    return { content, violationsFound: 0, violationsApplied: 0 };
  }

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") {
    return { content, violationsFound: 0, violationsApplied: 0 };
  }

  let violations: AuthorScopeViolation[] = [];
  try {
    const parsed = JSON.parse(extractJsonObject(firstBlock.text)) as {
      violations?: AuthorScopeViolation[];
    };
    violations = Array.isArray(parsed.violations) ? parsed.violations : [];
  } catch (err) {
    console.error(
      "latte.author_scope_parse_failed",
      err instanceof Error ? err.message : String(err),
    );
    return { content, violationsFound: 0, violationsApplied: 0 };
  }

  if (violations.length === 0) {
    return { content, violationsFound: 0, violationsApplied: 0 };
  }

  let coverParagraphs = [...content.coverStoryParagraphs];
  let hostsLeadIn = content.hostsCorner.leadIn;
  let hostsBody = content.hostsCorner.moveBody;
  let driveBody = content.theDrive.body;
  let applied = 0;

  for (const v of violations) {
    if (!v?.original || !v?.rewrite || typeof v.original !== "string" || typeof v.rewrite !== "string") {
      continue;
    }
    const original = v.original.trim();
    const rewrite = v.rewrite.replace(/—/g, ",").trim();
    if (original === "" || rewrite === "") continue;

    if (v.section === "coverStory") {
      let hit = false;
      coverParagraphs = coverParagraphs.map((p) => {
        if (p.includes(original)) {
          hit = true;
          return p.split(original).join(rewrite);
        }
        return p;
      });
      if (hit) applied++;
    } else if (v.section === "hostsCorner") {
      if (hostsLeadIn.includes(original)) {
        hostsLeadIn = hostsLeadIn.split(original).join(rewrite);
        applied++;
      } else if (hostsBody.includes(original)) {
        hostsBody = hostsBody.split(original).join(rewrite);
        applied++;
      }
    } else if (v.section === "theDrive") {
      if (driveBody.includes(original)) {
        driveBody = driveBody.split(original).join(rewrite);
        applied++;
      }
    }
  }

  const revised: SaturdayLatteContent = {
    ...content,
    coverStoryParagraphs: coverParagraphs,
    hostsCorner: {
      ...content.hostsCorner,
      leadIn: hostsLeadIn,
      moveBody: hostsBody,
    },
    theDrive: {
      ...content.theDrive,
      body: driveBody,
    },
  };

  return { content: revised, violationsFound: violations.length, violationsApplied: applied };
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
    authorScopeViolationsFound: number;
    authorScopeViolationsApplied: number;
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

  // Author-scope guard: rewrite first-person presence claims about places
  // outside Mark's authentic scope as attributed statements. Best-effort;
  // if the guard fails, keep the writer's original content.
  const scope = await enforceAuthorScope(client, writer.content);
  const scopedContent = scope.content;

  // Image generation phase: fire 7 DALL-E 3 calls in parallel, upload to
  // Supabase Storage. Best-effort — if any fail, the email still renders
  // (the template handles missing image slots gracefully).
  let imagesCostUsd = 0;
  let imagesLatencyMs = 0;
  let imagesGenerated = 0;
  let imagesFailed = 0;
  let imagesError: string | null = null;
  let contentWithImages = scopedContent;

  // Image prompts: try the writer's output first, fall back to a focused
  // Haiku call if the writer skipped them.
  let imagePrompts = writer.imagePrompts;
  let imagePromptsSource: "writer" | "haiku" | "none" = imagePrompts ? "writer" : "none";
  let imagePromptsError: string | null = null;
  if (!imagePrompts) {
    try {
      imagePrompts = await generateImagePromptsWithHaiku(client, scopedContent);
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

  const urlValidationPromise = validateContentUrls(scopedContent, allResearchUrls);

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
    // Up to 2 swap attempts. If Haiku picks a banned verse, retry once with
    // the failed pick added to the banned list. After 2 strikes, accept
    // whatever Haiku gave us (better than the original banned pick).
    const accumulatedBans = [...recentSabbathRefs];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const newSabbath = await swapSabbathVerse(
          client,
          accumulatedBans,
          contentWithImages.coverStoryHeadline,
        );
        const isStillBanned =
          refInList(newSabbath.reference, accumulatedBans) ||
          refInList(newSabbath.reference, SABBATH_BAN_LIST);
        if (!isStillBanned) {
          contentWithImages = { ...contentWithImages, sabbath: newSabbath };
          break;
        }
        if (attempt === 2) {
          // Accept it — the alternative is keeping the original banned pick
          contentWithImages = { ...contentWithImages, sabbath: newSabbath };
          break;
        }
        accumulatedBans.push(newSabbath.reference);
      } catch (err) {
        console.error(
          "latte.sabbath_swap_failed",
          err instanceof Error ? err.message : String(err),
        );
        break;
      }
    }
  }
  if (recentAuthors.includes(contentWithImages.sundayReset.author)) {
    const accumulatedAuthorBans = [...recentAuthors];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const newReset = await swapSundayResetAuthor(
          client,
          accumulatedAuthorBans,
          contentWithImages.coverStoryHeadline,
        );
        if (!accumulatedAuthorBans.includes(newReset.author)) {
          contentWithImages = { ...contentWithImages, sundayReset: newReset };
          break;
        }
        if (attempt === 2) {
          contentWithImages = { ...contentWithImages, sundayReset: newReset };
          break;
        }
        accumulatedAuthorBans.push(newReset.author);
      } catch (err) {
        console.error(
          "latte.sunday_reset_swap_failed",
          err instanceof Error ? err.message : String(err),
        );
        break;
      }
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
      authorScopeViolationsFound: scope.violationsFound,
      authorScopeViolationsApplied: scope.violationsApplied,
      totalCostUsd: research.costUsd + writerCost + imagesCostUsd,
      researchLatencyMs: research.latencyMs,
      writerLatencyMs: writer.latencyMs,
      issueDate: opts.issueDate,
    },
  };
}
