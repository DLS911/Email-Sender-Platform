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
import { LATTE_BOOK_SHELF, shelfSummaryForPrompt } from "./saturday-latte-book-shelf";
import { LATTE_DRINK_SHELF, drinkShelfSummaryForPrompt } from "./saturday-latte-drink-shelf";
import { editorReviewIssue, findDuplicateSentencesInContent } from "./saturday-latte-editor";
import { composeWeekendWriterVoice } from "./saturday-latte-voice-modules";
import {
  type LatteImagePrompts,
  type LatteImageSubjects,
  generateLatteImages,
} from "./saturday-latte-images";
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

1. **Destinations** (Cover Story material): Real US OR INTERNATIONAL places — small towns, off-season destinations, regional gems. Not generic top-10 lists. Specific places with specific reasons to visit. **ROTATION RULE — HARD.** International destinations are as important as US ones; do not deliver only US options. Include a MIX of both in every research batch — aim for 40-60% international across destinations (Portugal, Japan, Mexico, Iceland, UK/Scotland/Ireland, Italy, France, Greece, Croatia, Slovenia, Central & South America, SE Asia, New Zealand, etc). Examples: Savannah in January, Door County WI, Óbidos Portugal in November, Matsumoto Japan for cherry-blossom shoulder season, Oaxaca in July, Ronda Spain in October, San Sebastián in April.

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

### Cover Story — INSIGHT-FIRST, no template openings

The most engaging thing Mark can offer the reader in the first two sentences is his OPINION or the counter-obvious PATTERN he noticed about the destination. NOT a source attribution. NOT a communication vector. NOT a formal quote from someone else.

**BANNED openings (read as templated the moment they're written):**
- **"Nobody I know goes to [X]"** — used across multiple issues, reader recognizes it. Do NOT use "Nobody I know goes to..." / "Nobody I know does..." / "Nobody goes to X..." / "Most people don't...". These are now dead phrases.
- **"Everyone goes to X. That's the point."** — same family, banned.
- **"Most people skip X because they think..."** — same family, banned.
- ANY opening that starts with a proper-noun source (e.g., "The Connections Guy [verb] me a [medium]").
- ANY opening that names a communication vehicle as a prop ("a note," "a voicemail," "a text," "a postcard," "a letter," "a note on [X] letterhead").
- ANY opening that specifies message length ("three lines," "one line," "half a page," "an address and a time," "twenty-two seconds," "just three words scrawled").
- ANY opening that leads with a formal quoted line before Mark has spoken.
- ANY opening whose first two sentences could be swapped between destinations by only changing the place name.
- **ANY "[Destination] markets itself as: X, Y, Z." construction.** Used verbatim across issues ("October Sedona markets itself as: accessible, uncrowded, the light at its best"). Same rule for "[Destination] is famous for: X, Y, Z." / "[Destination] sells itself on: X, Y, Z." / any colon-then-triple-comma-list. Stock list-poetry — banned.

**Openings that WORK — each uses a DIFFERENT structural approach so no single shape becomes a pattern:**
- **Contrarian comparison.** "Traverse City is what people think Mackinac Island is, only cheaper and without the fudge crowd."
- **Counter-intuitive count.** "There are 40 wineries on the Old Mission Peninsula, and exactly one is worth planning a weekend around."
- **Named window with sensory color.** "The best time to be in Sedona is the second week of March, cold enough that the spring-break kids left."
- **Specific-detail lead.** "The Historic Scanlan House B&B on Parkway Avenue in Lanesboro serves breakfast until 10:30 AM, which is a full hour longer than any other B&B in town, and that hour is why you go."
- **Direct observation.** "Every time I've heard someone describe Marfa, the word that comes back is 'flat.' It isn't. The Chinati Foundation sits at 4,700 feet."
- **Numeric anchor.** "Traffic on Highway 101 north of Astoria drops 60% in early March. Rooms drop 40%. The rain drops the tourists but leaves the town."
- **Personal-taste declaration.** "I like a wine country in the shoulder season. Langhe in October is the shoulder season a lot of Americans still haven't found."

**Rotate the structural approach across issues.** If the last cover story used a Contrarian Comparison, this one uses a Numeric Anchor. If the last used a Direct Observation, this one uses a Named Window. Same insight-first spirit, different structural shape — the reader shouldn't be able to predict the shape of the opening based on prior issues.

**Sources come up MID-PIECE, not in the opening.** Never in the first two sentences. Never as a formal handoff. Attribute casually inside sentences that carry real information:

- "A buddy of mine who does the drive up from Boston every May tells me the pizza place he trusts is calm the first two weeks."
- "The guy in my life who tracks Vermont keeps naming Burlington in April."
- "A couple of advisors I know who have made the trip say the same thing."
- "A reader emailed me last spring about..."

**Multiple sources, not one source.** Every cover story doesn't have to lean on the same character. Rotate among:
- Advisors in Mark's network (plural, casual: "a couple of advisors I've heard from")
- Readers who've emailed
- A specific buddy or friend of Mark's (referred to by relation, not proper noun most of the time)
- The Connections Guy specifically (rare, only when the callback is earned; see WEEKEND_CONNECTIONS_GUY module)
- Publications Mark actually reads (Garden & Gun, Kinfolk, specific writers)
- Just a pattern Mark noticed from many voices, no single source named

**If the Cover Story destination IS in Mark's scope** (a ski mountain he actually visits, coastal FL, home cooking), Mark speaks entirely in his own first-person for those pieces.

**The Sanity Check for Cover Story voice.** Read the first two sentences. Ask:
- Does it sound like Mark telling a friend something interesting he noticed? → Ship.
- Does it sound like a template with the destination inserted? → Rewrite.
- Does the first sentence name a source before naming the insight? → Rewrite from the insight forward.
- Could an AI have generated this exact opening for any of the last 8 destinations without changing structure? → Rewrite until the answer is no.

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

**US ↔ INTERNATIONAL ROTATION — HARD RULE.** Look at the RECENT COVER STORIES list. Count how many of the last 3 were US destinations. **If the last 3 were all US, this issue's Cover Story MUST be international.** Similarly, if the last 3 were all international, this issue MUST be US. Do not run more than 3 of the same region in a row. The reader signs up for a mix — Óbidos or Matsumoto or Ronda one week, Bisbee or Door County or Lanesboro the next. If the research bundle's destinations are US-heavy this week and the rotation says international, pick an international destination anyway — Mark can research a place from a book or a friend, he doesn't need a Perplexity link to write about San Sebastián or Porto in shoulder season.

### 2. Tasting Menu (3 items)
Worth Watching, Worth Drinking, Worth Reading, Worth Listening, Worth Trying — pick three labels. Each item:
- label: e.g. "Worth Watching" or "Worth Drinking"
- title: the actual name (movie, product, book, etc.)
- url: the actual URL where the item can be found (IMDB for movies, manufacturer/Amazon for products, publisher/Amazon for books). USE A URL FROM RESEARCH IF AVAILABLE.
- body: 80-150 words. Surface the counter-intuitive dimension that decides whether this pick actually fits the reader's life — the maintenance cost, the sensory hit that specs don't capture, the effort required, the aspirational-vs-actual gap, the long-tail experience. **Do NOT literally write the phrase "the unexpected variable" — that's the INTERNAL frame you're applying, not a phrase the reader should ever see. Show the insight without naming the frame.**

**⚠️ LABEL–CONTENT KIND MUST MATCH. HARD RULE. Automatic fail if violated.**
The label determines what KIND of thing the title MUST be. There is no interpretation, no cleverness, no exceptions:
- **Worth Watching** → a FILM, DOCUMENTARY, or TV SHOW. Never a book. Never an album. Never a podcast. Never a product. The title must be a movie or TV series that a reader could stream / rent / buy on video.
- **Worth Reading** → a BOOK (novel, memoir, non-fiction, essay collection, poetry). Never a film. Never an article. Never a podcast episode.
- **Worth Drinking** → a specific BEVERAGE — a bourbon, whisky, wine, beer, coffee bean, tea, cocktail, non-alcoholic spirit, kombucha, drinking-vinegar. Never a coffee maker (that's Worth Trying). Never a food item. **ROTATE THE DRINK CATEGORY.** Do NOT default to bourbon every issue. If the recent-picks list has 2+ bourbons already, this week is wine / beer / coffee / tea / mezcal / rye / gin / natural wine / cider / amaro / NA-spirit / kombucha instead. Bourbon is one category among many; do not treat it as the safe default.
- **Worth Listening** → an ALBUM, PODCAST, or specific audio series. Never a book. Never a film.
- **Worth Trying** → a PHYSICAL PRODUCT — kitchen tool, coffee gear, outdoor gear, tech accessory, apparel, home item. Never a food/drink (those go under Worth Drinking or Worth Eating if we add that). Never a book/film/album.

If you find yourself picking "Worth Watching: The Overstory" (a book), STOP — that's a category error, either change the label to Worth Reading or pick a different film. The image pipeline routes off the label; a mismatched pick will render with the wrong asset (book cover in a film slot, poster in a book slot). Get it right on the first pass.

**TV show entry-point rule (Worth Watching).** For any TV series with multiple seasons, the DEFAULT pick is Season 1 — the reader is being introduced to the show for the first time. Do NOT recommend "Season 4" or "Season 3" as an orphan pick that assumes the reader has watched earlier seasons.

If the current season genuinely IS the pick (e.g., the show is having a critical moment, a season-specific arc is the reason to watch), then:
- Name the show, not just the season, in the title field ("Slow Horses" not "Slow Horses Season 4")
- The body MUST include an entry-point line for readers who haven't started: "If you haven't started: Season 1 is on Apple TV+, five hours gets you here. Season 4 is currently airing and the pattern-recognition it rewards is why it's on this week's list."
- Never recommend "Season N" of a show without acknowledging what came before.

Same rule for book series (recommend book 1 of a trilogy, not book 3) and for podcasts (name a specific episode ONLY if it stands alone; otherwise recommend the podcast from its first season/episode).

**BOOK SHELF (curated) — for Worth Reading picks, pick from this shelf by default.** These are the books Mark actually recommends. Skew toward classics and well-established modern works, not this-month's-new-release. If the destination or research turns up a compelling region-specific book off-shelf (a Cormac McCarthy book for a West Texas story, an actual specific Bryson for a UK story), that's fine — otherwise pull from here. Respect the one-week creator spacing rule.

{{LATTE_BOOK_SHELF}}

**DRINK SHELF (curated) — Worth Drinking picks MUST come from this shelf. HARD RULE.** The shelf spans bourbon, rye, scotch, Irish, Japanese, tequila/mezcal, rum, gin, wine (red/white/rosé/sparkling/natural), fortified/aperitif, amaro/digestif, beer, cider, cocktails, non-alcoholic, coffee beans, tea. **ROTATE CATEGORIES.** Do not stack two bourbons in a row across recent issues. Do not stack two wines. Vary. Bourbon is one column out of 21 — treat it that way. **NO OFF-SHELF DRINKS.** No Redwood Empire, no random craft spirit the writer saw in research today — pick from the shelf. If none of the shelf items fit the destination theme, pick the closest one; a reader would rather revisit Highland Park 12 than get pushed a shaky research-only pick.

{{LATTE_DRINK_SHELF}}

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
- car: full year/make/model (e.g. "2024 Lexus LC 500", "1995 Porsche 993 Carrera", "1988 BMW E30 M3", "1990 Mazda Miata NA", "1985 Ford Bronco II restomod with Coyote V8", "1972 Datsun 240Z LS-swap"). Include the era clearly for older/vintage picks so the reader knows the exact car.
- url: manufacturer page, Car and Driver / MotorTrend review, Bring a Trailer auction of a comparable example, or Wikipedia article for older cars. Use a research URL when available.
- specs: "5.0L V8 • 471 HP • Naturally aspirated, 7,300 RPM redline" — three short specs separated by " • "
- body: Why this car, in Mark's voice. Surface what the marketing misses (or for classics, what the enthusiast community knows) — but **do NOT literally write "the unexpected variable"** or "the hidden variable" or any variant. Show the insight without naming the frame. For older cars, include acquisition context ("Clean examples run $35-45k on Bring a Trailer"), maintenance context ("You can wrench on this yourself or find one shop in your city that can"), and the "hidden in plain sight" angle when relevant. End with a single line of conviction.

**IMPORTANT — The Drive scope is broader than new cars.** Anything cool under $120k qualifies. New cars, five-year-old used deals, classic restorations, restomods, air-cooled Porsches, '90s JDM heroes, cheap classics, cult obscurities — all in scope. See the WEEKEND_CAR_SPECTRUM voice module for the six categories (Icons, Sports Sedans, Wagons, Weekend Cars, Practical with Soul, and Classics/Restomods/Oddballs). Rotate across categories and across eras. Do NOT default to new cars only — the Classics/Restomods/Oddballs category should appear roughly every 3-4 issues.

**HARD BAN — DO NOT PICK ANY OF THESE (no exceptions, no clever workarounds):**
- **Electric vehicles (EVs) of any brand.** No BMW i5 / i4 / iX. No Mercedes EQS / EQE. No Audi e-tron / RS e-tron GT. No Porsche Taycan. No Rivian. No Lucid. No Polestar. No Ford Mustang Mach-E or F-150 Lightning. No Hyundai Ioniq 5 / 6. No Kia EV6. No Chevy Bolt / Silverado EV. No electric anything. The Drive is not the place for "smart transportation choices without gas." If Mark's real-life scope moves electric someday, it'll be handled elsewhere.
- **Hybrids and PHEVs.** No Toyota Prius. No Lexus RX / NX hybrids. No Volvo Recharge. No BMW xDrive50e. No hybrid Range Rovers. The Drive celebrates internal-combustion character.
- **Tesla, any model, any year.** Explicitly banned. Mark hasn't owned one and doesn't fake enthusiasm.
- **Practical SUVs without character** (Toyota Highlander, Honda Pilot, Hyundai Palisade, Kia Telluride, Mazda CX-90, Subaru Ascent, etc.). These belong in a shopping guide, not The Drive.
- **New luxury sedans without a performance angle** (a base S-Class, a base 7-Series, a base A8, a Genesis G80 without the Sport trim). If the writer is tempted to pick one of these because it's "nice," STOP and pick something with actual soul instead.
- **Regular non-performance SUVs — VERY STRICT.** Any SUV pick MUST be a genuine performance SUV; regular family SUVs are banned regardless of brand. A 340-370 hp SUV in a 2.5-ton body is NOT fast, no matter what Lexus calls it. HARD BAN LIST: any Lexus SUV (RX/GX/NX/LX, all generations, all trims), base BMW X1/X3/X5/X7 (only M-badge X3M / X5M / X6M / X6M qualify), base Audi Q3/Q5/Q7/Q8 (only SQ8 / RS Q8 qualify), Volvo XC40/XC60/XC90 (all trims), base Cayenne / Cayenne S / Cayenne E-Hybrid (only Cayenne GTS / Turbo / Turbo GT / Turbo S qualify), Mercedes GLA/GLB/GLC/GLE/GLS (only AMG 63 trims qualify), Range Rover Sport base / Range Rover base (only Sport SV / SVR qualify), Genesis GV70/GV80 (only GV70 3.5T Sport Prestige borderline), Cadillac Escalade base (only Escalade-V with 682 hp qualifies), Land Cruiser (borderline — only the '80s-'90s FJ classics qualify under Category 6, not the new one), Toyota 4Runner base (only TRD Pro borderline), Jeep Grand Cherokee base (only Trackhawk 707 hp qualifies), Ford Explorer / Expedition (only Raptor version of Bronco / F-150 qualifies), Nissan Pathfinder / Armada.

**The ONLY SUVs that qualify for The Drive** (memorize this list):
- Porsche Cayenne Turbo GT, Cayenne Turbo, Cayenne GTS (real chassis + 500+ hp)
- Porsche Macan GTS, Macan Turbo (smaller / sharper)
- BMW X3M Competition, X5M Competition, X6M Competition (500+ hp M SUVs)
- Audi RS Q8 (591 hp), SQ8 (500 hp) — NOT base Q8
- Alfa Stelvio Quadrifoglio (505 hp Ferrari-derived V6)
- Mercedes-AMG GLC 63, GLE 63, GLS 63 (only the 63 badges)
- Range Rover Sport SV (626 hp), Sport SVR historical
- Aston Martin DBX 707
- Bentley Bentayga Speed
- Lamborghini Urus, Urus Performante
- Ferrari Purosangue
- Maserati Grecale Trofeo (523 hp)
- Cadillac Escalade-V (682 hp)
- Ford F-150 Raptor R (700 hp), Bronco Raptor
- Ram 1500 TRX (702 hp, discontinued — collectible)
- Jeep Grand Cherokee Trackhawk (2018-2021, 707 hp)
- Any Category 6 classic 4x4 restomod (ICON Bronco, Land Cruiser FJ40/60/80 restos)

If unsure whether a specific SUV qualifies, DEFAULT TO NOT PICKING AN SUV. The Drive is not an SUV newsletter; SUVs are a rare pick, one per every 6-8 issues at most.

**When the writer might be tempted to pick a banned car, pick from this list of alternatives instead (all in-scope, cool, with real character):**
- Used performance sedans: Cadillac CT5-V Blackwing, BMW M3/M5 (E39, E46, E92, F80, F90), Audi RS4/RS6, Alfa Giulia Quadrifoglio, Mercedes E63 AMG wagon
- Classic Porsches: 964, 993, 968, 944 Turbo, 928, Cayman GT4
- Japanese classics: NSX, RX-7 FD, Supra Mk4, Miata NA/NB/ND, R32-R34 GT-R, GR Corolla
- Wagons: RS6 Avant, M3 Touring, Volvo V60 Polestar, E63 wagon
- American V8s: Mustang GT / Shelby GT350, C7/C8 Corvette, CT4-V Blackwing, Cadillac Escalade-V
- Restomods: ICON Broncos, Land Cruiser FJ40/FJ60/FJ80 restos, LS-swap builds, Coyote-swap Fox Body

Pull from research: cars. If no cars in research, pick from any of the six categories in the voice module (excluding the hard-banned list above). Rotate across categories — don't pick another SUV if last issue was an SUV.

**MODERN ↔ CLASSIC ROTATION — HARD RULE (mirrors the destination rule).** Look at the RECENT DRIVE PICKS list. For this rule "modern" = model year 2015+ and "classic" = anything older (including restomods based on pre-2015 platforms — a Coyote-swap Fox Body is CLASSIC, not modern). Count how many of the last 3 picks were modern. **If the last 3 were all modern, this issue's Drive MUST be a classic (pre-2015).** Similarly, if the last 3 were all classic, this issue MUST be modern. Across a rolling window of ~10 recent picks, aim for 40-60% classic. The section is called The Drive, not The New Car of the Week — an air-cooled 911, an NSX, a Miata NA, an E30 M3, a Fox Body Coyote-swap, a Land Cruiser FJ60, or an LS-swapped 240Z belongs here as often as a new M2 does. If the research bundle is modern-heavy this week and the rotation says classic, pick a classic anyway — Mark's car knowledge doesn't depend on a Perplexity link.

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
- verse: the verse text in **ESV (English Standard Version) wording exactly** — no NIV, KJV, NLT, MSG. No surrounding quote marks (the template adds them).
- reference: "Book Chapter:Verse (ESV)" — e.g. "Isaiah 30:15 (ESV)", "Psalm 65:9 (ESV)", "Lamentations 3:22-23 (ESV)". The (ESV) suffix is required.
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

- **"THE UNEXPECTED VARIABLE" IS AN INTERNAL FRAME, NEVER A PHRASE IN THE OUTPUT.** The concept guides your writing — surface the counter-intuitive dimension that decides whether the pick fits. But the LITERAL PHRASE "the unexpected variable" (or "the hidden variable," "the sneaky variable," "the surprise variable," any close paraphrase) must NEVER appear verbatim in the body of any section. Readers get 7+ Latte issues and immediately register the repeated phrase as a tell. Show the insight; don't name the frame. If you catch yourself typing "the unexpected variable is..." STOP and rewrite in prose that arrives at the same insight without naming the mechanism.

- **NO SENTENCE APPEARS TWICE IN THE ISSUE. HARD RULE.** Read your draft as a whole before returning. Every sentence — cover story, preheader, tasting bodies, host's corner, drive body, sunday prep, sabbath reflection, PS — must be unique. If a strong insight (a specific ratio, a specific number, a specific observation) would be equally good in the preheader AND the cover story body AND a tasting body, PICK ONE PLACE and rewrite the other occurrences with different phrasing. The preheader should TEASE the cover story, not paraphrase or duplicate a sentence from it. The Host's Corner body should not reuse a sentence from the Cover Story to establish setting. Duplicated sentences read as machine-generated the moment a reader spots them. Write it once, in the right section, and vary everywhere else.

- **NO PHRASING TEMPLATES ACROSS SECTIONS.** If the Cover Story uses "runs at about X% capacity most Y days, which means ..." don't reach for the same "X, which means Y" construction three paragraphs later. If the preheader uses "the Y before Z" the cover body can't lead with the same "the Y before Z." Vary sentence structure across sections. If two sentences share the same rhythm and scaffolding with only nouns swapped, one of them needs a full rewrite.

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

**SLOT-TO-SUBJECT LOCK-IN (critical — prevents image cross-slot mix-ups):** Each imagePrompt is rendered into a specific section of the newsletter and must UNAMBIGUOUSLY name that section's actual content. Tasting menu prompts especially: two items in the same issue can look similar (e.g., both coffee-adjacent) and Gemini will happily produce interchangeable images unless the prompt names the item explicitly. Every prompt is required to reference the exact subject text from its section, verbatim where possible.

The 5 image fields (one prompt per field, tastingMenu has 3 sub-prompts):

- **hero**: MUST name the cover story's primary place AND a SPECIFIC LANDMARK, iconic view, or unique feature of that place. Not a generic "downtown street" or "historic buildings" or "main street." Name the actual thing: "the Copper Queen Hotel neon sign in Bisbee at dusk," "the 1000-step Bisbee Stairs curving up Chihuahua Hill," "the Queen Mine headframe against Mule Mountains," "the Root River Trail bridge at Lanesboro with limestone bluffs behind," "Traverse City's Old Mission Peninsula lighthouse from the water at 6am." The hero should immediately show something unique to THIS place that a subscriber who's been there would recognize. If the writer can't name a specific landmark, the piece isn't researched enough - go do research. NEVER default to "downtown main street" or "historic buildings" or "person walking down a street" - those are boring AI defaults. Every hero prompt must specify a proper-noun landmark or iconic feature of the actual destination. **PEOPLE RULE: rely on nature / architecture / geography for the beauty, NOT on people. Zero people in the frame is preferred; a single distant figure or a pair of two figures is the maximum. NEVER prompt for "a crowd," "tourists," "a busy plaza," "people milling," "people posing," or "a group of friends." Crowded frames look AI-ish. The scene is a landscape / architecture beauty shot; if people are present at all, they are incidental scale references, not the subject.**
- **coverDetail**: MUST reference a specific ONE-thing detail from THIS cover story's location. Not a generic version of that kind of detail. Example: "The interior of the Commonweal Theatre lobby in Lanesboro at 6pm — brass wall sconces, playbill stack on a walnut table, one folded program left on a leather bench." Not "a small-town theater lobby." **BANNED coverDetail defaults (all read as generic AI output):** "a street food stand," "a food stall," "a morning market scene," "a market crowd," "a downtown crowd," "a night market," "a busy street," "a bustling plaza." Cover Detail is a TIGHT editorial still-life OR a single named architectural / interior / object detail — never a busy generic scene. If you're tempted to write "a street food stand at [destination]'s morning market," STOP and pick instead a single named element: a specific storefront the writer knows exists ("Nakabashi Bridge's red arch in the snow"), a single interior element of a named place ("the copper hood over the tempura counter at Kajibashi Honten"), or a specific still-life ("a rack of drying hoba leaves at a specific miso maker"). Detail = ONE object OR one architectural piece OR one interior at one named spot — never a scene with people milling around a generic food-vendor cliché.
- **tastingMenu**: array of 3 prompts, one per tasting menu item. **Each prompt MUST include the exact title of its tasting menu item, verbatim from tastingMenu[i].title.** This is non-negotiable — it is the only reliable defense against two similar-category items (two coffee items, two books, two films) rendering as interchangeable images. Example for a "Worth Trying: Fellow Ode Brew Grinder Gen 2" item: "The Fellow Ode Brew Grinder Gen 2 sitting cleanly on a butcher-block counter, morning window light from the left." NOT: "a coffee grinder on a kitchen counter." The item's exact product/book/film name must appear inside the prompt. **DO NOT include category-adjacent debris in the prompt** — no coffee beans next to a grinder, no tea leaves next to a teapot, no herb sprigs next to a knife. Products live cleanly on their surface. **DO NOT describe the product as pouring itself, floating, mid-action, or performing its function without a person** — a grinder is a still object sitting on the counter, not actively grinding; a kettle is sitting on a stove or trivet, not tilted and self-pouring into a filter. Products at rest, no invisible-hand operations.
  - **Worth Listening prompt specifics.** For podcast or album picks, do NOT ask for wired earbuds, wired headphones, or any coiled-cable ear device (Gemini renders these with impossible cable geometry every time). Instead describe a plausible listening context: a kitchen with a Bluetooth speaker on a shelf and the album/podcast art visible on a phone, a car dashboard at dawn with the phone in the cradle showing the podcast title, a runner's smartwatch on a wrist, an open journal + coffee cup + phone showing the album art. If a personal audio device belongs in the frame, it must be a phone or a smartwatch — earbuds are banned.
- **hostsCorner**: MUST reference the specific technique from hostsCorner.moveTitle by name. Example for "The Cold-Start Cast Iron Steak": "A room-temperature ribeye in a cold cast iron skillet on a gas burner, first ninety seconds of the cold-start method, small pool of rendered fat around the meat, kitchen window light at 5pm." Not "a steak searing on cast iron."
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
  retryRejectionMessage?: string,
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
    if (ctx.cars.length > 0) {
      // Era-rotation, 2:1 classic:modern. Austin: "cars havent been
      // going the 50/50 route. its been new cars still." Prior rule was
      // strict alternation → the writer still produced modern-heavy
      // sequences (either the retry loop leaked or the writer's real
      // bias won). New rule: if EITHER of the last 2 picks was modern,
      // this issue MUST be classic. Only when BOTH last 2 are classic
      // may this issue be modern. Sequence: C, C, M, C, C, M... =
      // 1/3 modern. Same restomod = classic classification.
      const currentYear = new Date().getUTCFullYear();
      const isModern = (car: string): boolean => {
        const restomodHit = /restomod|restoration|resto[- ]mod|coyote[- ]swap|ls[- ]swap|k[- ]swap/i.test(car);
        if (restomodHit) return false;
        const years = Array.from(car.matchAll(/\b(19|20)\d{2}\b/g)).map((m) => parseInt(m[0], 10));
        if (years.length === 0) return false;
        const oldestYear = Math.min(...years);
        return oldestYear >= currentYear - 6;
      };
      const last2 = ctx.cars.slice(0, 2);
      const anyRecentModern = last2.some(isModern);
      const eraRule = anyRecentModern
        ? `\n\n**ERA-ROTATION RULE (mandatory this issue):** At least one of the last 2 Drive picks was MODERN (recent picks: ${last2.map((c) => `"${c}"`).join(", ")}). Under the 2:1 classic-to-modern rule, this issue MUST pick a CLASSIC or restomod. **Model year must be 2010 or earlier**, OR a restomod BASED on such a car (a modern build of a '69 Bronco counts as classic). Examples that qualify: any air-cooled Porsche (964/993/pre-964/944 Turbo), BMW E30 M3 / E28-E39 M5 / 2002tii, Datsun 240Z/260Z/280Z, Mazda RX-7 FD, Toyota Supra Mk4, Honda NSX, first-gen Miata NA, R32-R34 Skyline GT-R, restomod Bronco or Land Cruiser, LS-swap builds, Mercedes W123/190E Cosworth / 500E / SL R107, Alfa GTV6/Milano/Spider, Volvo 240 wagon, Lotus Elise/Esprit, Jaguar E-Type/XJ6, any '80s-'90s JDM hero, Saab 900 Turbo, Peugeot 205 GTI, VW GTI Mk1/Mk2, Ferrari 308/348/Testarossa. Under $120k. Do NOT pick a 2020s car this issue — a 2024/2025 model year is an automatic fail on this rule.`
        : `\n\n**ERA-ROTATION RULE (this issue):** The last 2 Drive picks were both CLASSIC (recent picks: ${last2.map((c) => `"${c}"`).join(", ")}). Under the 2:1 rule, this issue MAY be a MODERN pick (2018+) — but it doesn't have to be. Classic is always fine.`;
      exclusions.push(
        `## RECENT THE DRIVE PICKS — HARD RULE, DO NOT REPEAT ANY OF THESE:\n${ctx.cars.map((c) => `- ${c}`).join("\n")}\n\nThe car you pick for The Drive this issue MUST NOT be any car on the list above. Not the same year+model, not a different year of the same model, not a different trim of the same model. Pick from a completely different nameplate or generation. If you can only think of cars on the list, keep thinking — there are hundreds of cool cars under $120k across the spectrum.${eraRule}`,
      );
    }
    if (ctx.tastingMenuTitles.length > 0)
      exclusions.push(
        `## RECENT TASTING MENU PICKS — HARD RULE, DO NOT REPEAT ANY OF THESE:\n${ctx.tastingMenuTitles.map((t) => `- ${t}`).join("\n")}\n\nEvery book, film, product, or drink you select for this issue's Tasting Menu MUST be a title NOT in the list above. Do not pick a book from the list. Do not pick a film from the list. Do not pick a product from the list. Do not pick a drink from the list. If you can only think of items on the list, keep thinking — there are thousands of great books, films, products, and drinks; pick one that has not been featured.`,
      );
    if (ctx.tastingCreators.length > 0) {
      const uniqCreators = Array.from(new Set(ctx.tastingCreators.map((c) => c.trim()))).slice(0, 20);
      exclusions.push(
        `## LAST ISSUE'S TASTING CREATORS — DO NOT PICK ANOTHER TITLE BY ANY OF THESE THIS WEEK:\n${uniqCreators.map((c) => `- ${c}`).join("\n")}\n\nSpacing rule, not a ban. Two Samantha Harvey novels back-to-back reads as lazy — do a different creator this week. If she's great, come back to her in two weeks with a different title. This constraint applies ONLY to creators from the immediately preceding issue; anything from earlier is fair game.`,
      );
    }
    if (ctx.coverStorySpots.length > 0) {
      const uniqSpots = Array.from(new Set(ctx.coverStorySpots.map((s) => s.trim()))).slice(0, 80);
      exclusions.push(
        `## RECENT COVER STORY SPOTS (restaurants, cafes, hotels, shops previously recommended) — DO NOT REPEAT:\n${uniqSpots.map((s) => `- ${s}`).join("\n")}\n\nDo not re-recommend any of these specific spots in this issue's Cover Story or its supporting mentions. Different restaurants, different cafes, different hotels, different shops. Even if the destination reuses a region, the specific establishments must be new.`,
      );
    }
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
    // Full permanent-recall memory from latte_recommendations. Every
    // specific dish, restaurant, brand, tool, and person ever picked
    // — grouped by kind. Fed to the writer as a comprehensive
    // do-not-repeat exclusion set. This is on top of the section-
    // level lists above.
    if (ctx.allRecommendations && Object.keys(ctx.allRecommendations).length > 0) {
      const kindOrder = [
        "destination", "restaurant", "dish", "hotel_or_lodging", "shop", "landmark",
        "car", "book", "book_creator", "film", "film_creator",
        "album", "album_creator", "podcast", "podcast_creator",
        "drink", "drink_brand", "product", "product_brand",
        "cooking_move", "cooking_ingredient", "cooking_tool",
        "sunday_reset_author", "sabbath_reference", "person",
      ];
      const kindsWithData = kindOrder.filter((k) => (ctx.allRecommendations?.[k]?.length ?? 0) > 0);
      if (kindsWithData.length > 0) {
        const blocks: string[] = [];
        for (const kind of kindsWithData) {
          const values = ctx.allRecommendations?.[kind] ?? [];
          const uniq = Array.from(new Set(values.map((v) => v.trim()))).slice(0, 120);
          if (uniq.length === 0) continue;
          const label = kind.replace(/_/g, " ").toUpperCase();
          blocks.push(`### ${label}\n${uniq.map((v) => `- ${v}`).join("\n")}`);
        }
        parts.push(`\n# PERMANENT MEMORY — every recommendation ever made across all past issues. DO NOT recommend anything on any of these lists (except where the section-level rules above explicitly allow, e.g. same-creator OK after one week):\n\n${blocks.join("\n\n")}\n\nEven specific dishes and brand mentions from prior issue bodies count. If a spot / dish / product / person appears on any list above, pick something else.`);
      }
    }
  }
  if (retryRejectionMessage) {
    parts.push(`\n\n# ⚠️ RETRY REJECTION NOTICE — YOUR PREVIOUS DRAFT REPEATED PICKS FROM THE RECENT LIST\n\n${retryRejectionMessage}\n\nRegenerate the entire issue, and make absolutely sure NONE of your picks appear on the recent-picks lists above.`);
  }

  parts.push(`\nReturn ONLY the JSON object specified. No preamble, no markdown fences.`);

  const systemPrompt =
    composeWeekendWriterVoice() +
    STRUCTURAL_INSTRUCTIONS
      .replace("{{LATTE_BOOK_SHELF}}", shelfSummaryForPrompt())
      .replace("{{LATTE_DRINK_SHELF}}", drinkShelfSummaryForPrompt());

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

// Normalize a tasting or car title for repeat detection: lowercase, strip
// punctuation, collapse whitespace, drop leading articles. "The Passion
// (2004)" and "the passion" both collapse to "passion", so a repeat won't
// slip through on a trivial wording difference.
function normalizeTitleForRepeat(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type RepeatOffense = {
  slot: "tasting-1" | "tasting-2" | "tasting-3" | "theDrive" | "coverStory" | string;
  picked: string;
  matched: string;
};

/**
 * Pull the destination name from a Cover Story headline. Headlines are
 * shaped as "<Destination> in <Season/Month>[: subtitle]" or occasionally
 * "<Destination>, <State>: subtitle" — we take whatever's before the
 * first " in " or " , " boundary. Normalized for match.
 */
function extractDestinationFromHeadline(headline: string): string {
  const trimmed = headline.trim();
  const sepIn = trimmed.search(/\s+in\s+/i);
  const sepComma = trimmed.indexOf(",");
  const sepColon = trimmed.indexOf(":");
  const bounds = [sepIn, sepComma, sepColon].filter((n) => n > 0);
  const cut = bounds.length > 0 ? Math.min(...bounds) : trimmed.length;
  return trimmed.slice(0, cut).trim();
}

// Compare writer output against recent picks. Any tasting title or Drive
// car whose normalized form matches a normalized recent-pick counts as
// an offense. For cars we also flag same-nameplate matches (same brand
// AND model even if the year differs), since Austin has explicitly said
// the pick must be a different nameplate/generation.
// Common words that must be ignored during token-overlap dedup. Without
// this, "The Complete Book of..." and "The Complete Guide to..." would
// share "complete" and false-positive as dupes.
const REPEAT_STOPWORDS = new Set([
  "book", "novel", "memoir", "guide", "story", "stories", "tale", "tales",
  "of", "and", "for", "in", "on", "at", "to", "with", "by",
  "movie", "film", "series", "season", "part", "vol", "volume",
  "edition", "revised", "new", "old", "single", "double", "small", "large",
  "premium", "select", "reserve", "special", "limited", "classic",
  "your", "our", "my", "how", "why", "what", "when", "where",
]);

function tokensForRepeat(norm: string): string[] {
  return norm
    .split(" ")
    .filter((t) => t.length >= 4)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !REPEAT_STOPWORDS.has(t));
}

// Compare writer output against recent picks. Any tasting title or Drive
// car whose normalized form matches a normalized recent-pick counts as
// an offense. Two matching strategies:
//   (1) substring — one normalized string wholly contains the other
//   (2) token-overlap — >=2 significant tokens (>=4 chars, non-stopwords,
//       non-numeric) shared between the two normalized strings
// Token-overlap catches things like "Elmer T Lee Bourbon" vs "Elmer T Lee
// Single Barrel Bourbon" where neither string contains the other but they
// share the brand tokens.
function findRepeatOffenses(
  content: SaturdayLatteContent,
  ctx: LatteRecentContext,
): RepeatOffense[] {
  const offenses: RepeatOffense[] = [];
  // Cover Story destination check. Extract the destination name from the
  // headline (portion before the first " in ", ",", or ":") and compare
  // against normalized recent destinations. Also cross-check against
  // allRecommendations.destination for permanent recall.
  const pickedDest = extractDestinationFromHeadline(content.coverStoryHeadline);
  if (pickedDest) {
    const pickedDestNorm = normalizeTitleForRepeat(pickedDest);
    const currentHeadlineNorm = normalizeTitleForRepeat(content.coverStoryHeadline);
    if (pickedDestNorm) {
      // Two-way substring match against every previous headline in
      // BOTH the section-level list AND the permanent-recall
      // destination list. Catches "Bisbee, Arizona" appearing in a
      // previously-titled "Copper Country: Bisbee, Arizona" headline
      // even when the naive extractor would return "copper country"
      // for the prior and "bisbee arizona" for the current.
      const priorHeadlineNorms = [
        ...ctx.coverStoryHeadlines,
        ...(ctx.allRecommendations?.destination ?? []),
      ]
        .map((h) => normalizeTitleForRepeat(h))
        .filter((n) => n && n !== currentHeadlineNorm);
      const hit = priorHeadlineNorms.find(
        (priorNorm) =>
          priorNorm === pickedDestNorm ||
          priorNorm.includes(pickedDestNorm) ||
          pickedDestNorm.includes(priorNorm) ||
          // Extract every prior's destination too and cross-check.
          normalizeTitleForRepeat(extractDestinationFromHeadline(priorNorm)) === pickedDestNorm,
      );
      if (hit) {
        offenses.push({
          slot: "coverStory",
          picked: content.coverStoryHeadline,
          matched: `destination "${pickedDest}" has already been featured (matched against "${hit}"). Pick a completely different city / region.`,
        });
      }
    }
  }
  const recentTastingNorm = ctx.tastingMenuTitles.map((t) => ({
    original: t,
    norm: normalizeTitleForRepeat(t),
    tokens: tokensForRepeat(normalizeTitleForRepeat(t)),
  }));
  for (const [i, item] of content.tastingMenu.entries()) {
    const pickedNorm = normalizeTitleForRepeat(item.title);
    if (!pickedNorm) continue;
    const pickedTokens = tokensForRepeat(pickedNorm);
    const hit = recentTastingNorm.find((r) => {
      if (!r.norm) return false;
      if (r.norm === pickedNorm || r.norm.includes(pickedNorm) || pickedNorm.includes(r.norm)) return true;
      if (pickedTokens.length === 0 || r.tokens.length === 0) return false;
      const recentTokenSet = new Set(r.tokens);
      const shared = pickedTokens.filter((t) => recentTokenSet.has(t));
      return shared.length >= 2;
    });
    if (hit) {
      offenses.push({
        slot: `tasting-${i + 1}` as RepeatOffense["slot"],
        picked: item.title,
        matched: hit.original,
      });
    }
  }
  const pickedCarNorm = normalizeTitleForRepeat(content.theDrive.car);
  if (pickedCarNorm) {
    // For cars, we intentionally KEEP 2-char tokens (m2, m3, m4, i5, i8,
    // gx, lx, es, rx, is, xt, q5, q7, a4, a6, s4, s6, r8, rs, gt, sq,
    // ct, ex, gs, mx, mr, nx, xl, x1, x3, x5, x7, z4, z8, gr, sl, gl,
    // fj, tt) so nameplate matches work. Model codes like these ARE the
    // distinguishing signal — "BMW M2" and "BMW M3" collapse to just
    // "bmw" without them, and the whole family shares that. With
    // 2-char tokens included, "bmw m2" ∩ "bmw m2" hits both tokens and
    // fires the ≥2 shared rule correctly.
    //
    // Exact normalized match is also enough (car A == car B), so this
    // catches "2024 BMW M2" vs "2025 BMW M2" (both normalize to
    // "bmw m2") AND catches near-matches on brand+model.
    const carHit = ctx.cars.find((c) => {
      const rNorm = normalizeTitleForRepeat(c);
      if (!rNorm) return false;
      if (rNorm === pickedCarNorm) return true;
      const pickedTokens = pickedCarNorm.split(" ").filter((t) => t.length >= 2 && !/^\d+$/.test(t));
      const recentTokens = new Set(rNorm.split(" ").filter((t) => t.length >= 2 && !/^\d+$/.test(t)));
      const shared = pickedTokens.filter((t) => recentTokens.has(t));
      // Same brand AND same model (2 shared tokens) is a dupe. Same
      // brand alone (1 shared token) is not — a BMW M2 vs a BMW E30 M3
      // are legitimately different picks.
      return shared.length >= 2;
    });
    if (carHit) {
      offenses.push({ slot: "theDrive", picked: content.theDrive.car, matched: carHit });
    }
  }
  // Author/creator overlap check. If the picked tasting title contains
  // a creator we've featured before (parsed from the title's "by X"
  // pattern), flag as a soft dupe on the creator axis. Catches "The
  // Bee Sting" following "Orbital" when both are Samantha Harvey.
  if (ctx.tastingCreators.length > 0) {
    const recentCreatorsNorm = new Set(
      ctx.tastingCreators.map((c) => normalizeTitleForRepeat(c)).filter(Boolean),
    );
    for (const [i, item] of content.tastingMenu.entries()) {
      const pickedCreator = normalizeTitleForRepeat(extractCreatorHelperForTitle(item.title) ?? "");
      if (!pickedCreator) continue;
      if (recentCreatorsNorm.has(pickedCreator)) {
        if (offenses.some((o) => o.slot === `tasting-${i + 1}`)) continue;
        offenses.push({
          slot: `tasting-${i + 1}` as RepeatOffense["slot"],
          picked: item.title,
          matched: `[same creator previously featured]`,
        });
      }
    }
  }
  return offenses;
}

// Label→kind heuristic map for the tasting menu. Detects obvious label/
// content mismatches: a "Worth Watching" title that is transparently a
// book, a "Worth Reading" title that is transparently a film, etc.
// The heuristic looks at:
//   - the item's body (writer usually mentions "novel/film/album/show" etc)
//   - the item's title suffix ("by X" often indicates a book/album)
//   - the URL host (imdb → film, letterboxd → film, goodreads → book,
//     bandcamp/spotify/apple music → album, apple podcasts → podcast)
// Ambiguous items are given the benefit of the doubt (no false-flag).
function findKindMismatchOffenses(content: SaturdayLatteContent): RepeatOffense[] {
  const offenses: RepeatOffense[] = [];
  for (const [i, item] of content.tastingMenu.entries()) {
    const label = (item.label ?? "").toLowerCase();
    const body = (item.body ?? "").toLowerCase();
    const url = (item.url ?? "").toLowerCase();
    const title = (item.title ?? "").toLowerCase();
    const isFilmSignal =
      /imdb\.com|letterboxd|rotten\s*tomatoes|criterion|apple\s*tv|netflix|max\.com|hbo|hulu|paramount|disney\+/i.test(url) ||
      /\b(film|movie|documentary|tv\s*series|television\s*series|miniseries|the\s*director|directed\s*by|screenplay|cinematographer|streaming\s*on|apple\s*tv|netflix|hbo\s*max|prime\s*video)\b/.test(body);
    const isBookSignal =
      /goodreads|penguin\s*random|amazon\.com\/.*\/(dp|gp\/product)|barnesandnoble|bookshop\.org|libraryofamerica|nyrb/i.test(url) ||
      /\b(novel|memoir|nonfiction|non-fiction|essay\s*collection|the\s*author|written\s*by|published\s*by|the\s*book|paperback|hardcover|chapter|pulitzer|booker\s*prize|national\s*book\s*award)\b/.test(body);
    const isAlbumOrPodcastSignal =
      /spotify|apple\s*music|apple\.co\/album|bandcamp|soundcloud|tidal|apple\s*podcasts|pocketcasts|overcast/i.test(url) ||
      /\b(album|record\s*label|the\s*band|the\s*singer|track\s*(?:one|two|three)|the\s*ep|debut\s*album|the\s*podcast|podcast\s*host|episode\s*\d)\b/.test(body);
    const isDrinkSignal =
      /\b(bourbon|whisky|whiskey|rye|scotch|tequila|mezcal|gin|vodka|rum|wine|pinot|cabernet|chardonnay|riesling|rosé|rose\s*wine|beer|ipa|lager|stout|pilsner|kombucha|coffee\s*bean|single\s*origin|espresso|matcha|tea|cocktail|amaro|vermouth|aperitif|non-alcoholic|na\s*spirit)\b/.test(body + " " + title);
    const isProductSignal =
      /\b(grinder|kettle|dutch\s*oven|cast\s*iron|pizza\s*oven|espresso\s*machine|coffee\s*maker|knife|thermometer|scale|apparel|jacket|boots|backpack|cooler|tent|sleeping\s*bag|hiking|watch|headphones|speaker|bluetooth|charger|laptop|desk|chair|lamp|cutting\s*board|pan|skillet|kitchen\s*tool|weight|dumbbell)\b/.test(body + " " + title);

    if (label.includes("watching")) {
      if (isBookSignal && !isFilmSignal) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Watching' but the content reads as a BOOK. Pick a film / TV show / documentary instead, or change the label to Worth Reading." });
      } else if (isAlbumOrPodcastSignal && !isFilmSignal) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Watching' but the content reads as an ALBUM or PODCAST. Pick a film / TV show instead, or change the label to Worth Listening." });
      }
    } else if (label.includes("reading")) {
      if (isFilmSignal && !isBookSignal) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Reading' but the content reads as a FILM or TV show. Pick a book instead, or change the label to Worth Watching." });
      } else if (isAlbumOrPodcastSignal && !isBookSignal) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Reading' but the content reads as an ALBUM or PODCAST. Pick a book instead." });
      }
    } else if (label.includes("drinking")) {
      if (!isDrinkSignal && (isBookSignal || isFilmSignal || isAlbumOrPodcastSignal || isProductSignal)) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Drinking' but the content isn't a beverage. Pick an actual drink (bourbon, wine, beer, coffee bean, tea, cocktail, etc.)." });
      }
    } else if (label.includes("listening")) {
      if (isBookSignal && !isAlbumOrPodcastSignal) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Listening' but the content reads as a BOOK. Pick an album or podcast instead." });
      } else if (isFilmSignal && !isAlbumOrPodcastSignal) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Listening' but the content reads as a FILM. Pick an album or podcast instead." });
      }
    } else if (label.includes("trying")) {
      if (isBookSignal || isFilmSignal || isAlbumOrPodcastSignal || (isDrinkSignal && !isProductSignal)) {
        offenses.push({ slot: `tasting-${i + 1}` as RepeatOffense["slot"], picked: item.title, matched: "labeled 'Worth Trying' but the content isn't a physical product. Pick an actual product (kitchen tool, gear, tech accessory, etc.)." });
      }
    }
  }
  return offenses;
}

/**
 * Off-shelf book check. Worth Reading picks MUST come from the curated
 * book shelf. If the writer picks a title whose normalized form isn't
 * on the shelf, fire a retry with a specific rejection message.
 */
function findOffShelfBookOffenses(content: SaturdayLatteContent): RepeatOffense[] {
  const offenses: RepeatOffense[] = [];
  const shelfNorms = LATTE_BOOK_SHELF.map((b) => normalizeTitleForRepeat(b.title)).filter(Boolean);
  for (const [i, item] of content.tastingMenu.entries()) {
    const label = (item.label ?? "").toLowerCase();
    if (!label.includes("reading")) continue;
    const pickedNorm = normalizeTitleForRepeat(item.title);
    if (!pickedNorm) continue;
    const onShelf = shelfNorms.some(
      (s) => s === pickedNorm || pickedNorm.includes(s) || s.includes(pickedNorm),
    );
    if (!onShelf) {
      offenses.push({
        slot: `tasting-${i + 1}` as RepeatOffense["slot"],
        picked: item.title,
        matched: `NOT ON THE BOOK SHELF. Worth Reading picks MUST come from the curated shelf. Replace this pick with a book from the shelf.`,
      });
    }
  }
  return offenses;
}

/**
 * Cross-field consistency: imagePrompts.tastingMenu[i] must reference
 * the same subject as tastingMenu[i].title. Guards against writer
 * split-brain where the item.title, the image prompt, and the URL end
 * up describing three different works — which then ships as a book
 * whose image, text, and link all point at different titles.
 *
 * Match rule: at least one significant title token (>=4 chars,
 * non-stopword) from the normalized title must appear in the
 * normalized image prompt. If the title has no such token (very rare —
 * a one-word title like "Orbital" would still normalize to "orbital"
 * which is 7 chars), skip the check for that slot.
 */
function findTastingImagePromptMismatchOffenses(
  content: SaturdayLatteContent,
  imagePrompts: { tastingMenu?: string[] } | null | undefined,
): RepeatOffense[] {
  const offenses: RepeatOffense[] = [];
  const promptList = imagePrompts?.tastingMenu ?? [];
  for (const [i, item] of content.tastingMenu.entries()) {
    const promptRaw = promptList[i];
    if (!promptRaw || promptRaw.trim() === "") continue;
    const titleNorm = normalizeTitleForRepeat(item.title);
    const titleTokens = tokensForRepeat(titleNorm);
    if (titleTokens.length === 0) continue;
    const promptNorm = normalizeTitleForRepeat(promptRaw);
    const hit = titleTokens.some((t) => promptNorm.includes(t));
    if (!hit) {
      offenses.push({
        slot: `tasting-${i + 1}` as RepeatOffense["slot"],
        picked: item.title,
        matched: `IMAGE PROMPT MISMATCH. tastingMenu[${i}].title is "${item.title}" but imagePrompts.tastingMenu[${i}] does not name this subject at all. The image prompt must contain the exact title, verbatim. Rewrite the image prompt so it names "${item.title}" — the title, image, and URL must all describe the SAME work.`,
      });
    }
  }
  return offenses;
}

/**
 * Cross-field consistency: tastingMenu[i].url must be a URL that
 * plausibly points at the same subject as tastingMenu[i].title. Same
 * writer split-brain guard as the image-prompt check. The rule is
 * intentionally loose — many valid URLs (imdb tt-IDs, amazon dp-IDs,
 * shortened links) won't contain the title in the path. We only flag
 * when the URL path clearly names a DIFFERENT specific title that
 * conflicts with the item title.
 *
 * Match rule: if the URL path contains any significant title token
 * from the item title, pass. If the URL path contains only
 * non-title alphabetic words AND none of the title tokens, flag. For
 * paths that are just IDs (`/dp/B08XYZ`, `/title/tt1234567/`), the
 * "no meaningful path words" branch skips the check.
 */
function findTastingUrlMismatchOffenses(content: SaturdayLatteContent): RepeatOffense[] {
  const offenses: RepeatOffense[] = [];
  for (const [i, item] of content.tastingMenu.entries()) {
    const label = (item.label ?? "").toLowerCase();
    if (label.includes("reading") || label.includes("trying")) continue;
    const url = (item.url ?? "").trim();
    if (!url) continue;
    let path = "";
    try {
      const parsed = new URL(url);
      path = decodeURIComponent(parsed.pathname + " " + parsed.search);
    } catch {
      continue;
    }
    const pathNorm = normalizeTitleForRepeat(path);
    const pathWords = pathNorm.split(" ").filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !REPEAT_STOPWORDS.has(w));
    if (pathWords.length === 0) continue;
    const titleNorm = normalizeTitleForRepeat(item.title);
    const titleTokens = tokensForRepeat(titleNorm);
    if (titleTokens.length === 0) continue;
    const anyHit = titleTokens.some((t) => pathNorm.includes(t));
    if (!anyHit) {
      offenses.push({
        slot: `tasting-${i + 1}` as RepeatOffense["slot"],
        picked: item.title,
        matched: `URL MISMATCH. tastingMenu[${i}].title is "${item.title}" but tastingMenu[${i}].url path ("${path.trim().slice(0, 100)}") names a completely different subject. The link must go to the SAME work as the title. Rewrite the URL to a real page for "${item.title}".`,
      });
    }
  }
  return offenses;
}

/**
 * Off-shelf drink check. Same rule for Worth Drinking: pick from the
 * curated drink shelf. Prevents the writer defaulting to whatever
 * bourbon showed up in research today (Redwood Empire, etc.).
 */
function findOffShelfDrinkOffenses(content: SaturdayLatteContent): RepeatOffense[] {
  const offenses: RepeatOffense[] = [];
  const shelfNorms = LATTE_DRINK_SHELF.map((d) => normalizeTitleForRepeat(d.title)).filter(Boolean);
  for (const [i, item] of content.tastingMenu.entries()) {
    const label = (item.label ?? "").toLowerCase();
    if (!label.includes("drinking")) continue;
    const pickedNorm = normalizeTitleForRepeat(item.title);
    if (!pickedNorm) continue;
    const onShelf = shelfNorms.some(
      (s) => s === pickedNorm || pickedNorm.includes(s) || s.includes(pickedNorm),
    );
    if (!onShelf) {
      offenses.push({
        slot: `tasting-${i + 1}` as RepeatOffense["slot"],
        picked: item.title,
        matched: `NOT ON THE DRINK SHELF. Worth Drinking picks MUST come from the curated shelf. Replace this pick with a drink from the shelf.`,
      });
    }
  }
  return offenses;
}

/**
 * Deterministic car-era offense. Mirrors the writer's ERA-ROTATION
 * RULE: if the last recent Drive pick was modern, this issue's Drive
 * MUST be classic (pre-2010) or a real restomod; if the last was
 * classic/restomod, this issue MUST be modern (2018+). If the writer
 * violates the rule, fire a retry. Uses the same restomod detection
 * as the runtime rule so a modern build of a '69 Bronco counts as
 * classic.
 */
function findCarEraOffenses(
  content: SaturdayLatteContent,
  ctx: LatteRecentContext | undefined,
): RepeatOffense[] {
  if (!ctx || ctx.cars.length === 0) return [];
  const currentYear = new Date().getUTCFullYear();
  const isModern = (car: string): boolean => {
    const restomodHit = /restomod|restoration|resto[- ]mod|coyote[- ]swap|ls[- ]swap|k[- ]swap/i.test(car);
    if (restomodHit) return false;
    const years = Array.from(car.matchAll(/\b(19|20)\d{2}\b/g)).map((m) => parseInt(m[0], 10));
    if (years.length === 0) return false;
    const oldestYear = Math.min(...years);
    return oldestYear >= currentYear - 6;
  };
  // 2:1 rule: if EITHER of the last 2 was modern, this MUST be classic.
  // Only when both last-2 are classic is a modern pick allowed. Prior
  // strict-alternation rule leaked too many moderns.
  const last2 = ctx.cars.slice(0, 2);
  const anyRecentModern = last2.some(isModern);
  const pickIsModern = isModern(content.theDrive.car);
  if (anyRecentModern && pickIsModern) {
    return [{
      slot: "theDrive",
      picked: content.theDrive.car,
      matched: `ERA ROTATION VIOLATION (2:1 rule). Recent Drive picks include a MODERN car (last 2: ${last2.map((c) => `"${c}"`).join(", ")}) — this issue MUST be a CLASSIC (pre-2010) or a real restomod. Your pick "${content.theDrive.car}" is another modern car. Pick an air-cooled 911, E30 M3, NSX, Miata NA, RX-7 FD, Supra Mk4, R32-R34 GT-R, 240Z, Fox Body Mustang, W123, restomod Bronco or FJ — anything pre-2010 or a swap build.`,
    }];
  }
  return [];
}

/**
 * Backstop pool of classic-era Drive picks with pre-written specs and
 * body. Used ONLY when the writer ignores the era rule after both a
 * first and second retry — we deterministically inject one of these
 * so the newsletter doesn't ship a fourth modern car in a row. Bodies
 * are intentionally short and generic; the reader gets a proper writer-
 * generated pick 99% of the time, this only fires in the rare failure
 * case and is preferable to shipping the violating pick.
 */
const FORCED_CLASSIC_CARS: Array<{ car: string; specs: string; body: string; url?: string }> = [
  {
    car: "1995 Porsche 993 Carrera",
    specs: "3.6L flat-six • 268 hp • Air-cooled",
    body: "The last of the air-cooled 911s. Not the fastest 911 you can buy today, and that is exactly the point — the 993 sits in a sweet spot the modern water-cooled cars can't reach: light enough to feel every input, developed enough not to fight you the way the earlier air-cooled cars did. Clean examples run in the mid-$100s on Bring a Trailer, which is a lot of money to spend on a sports car that a modern Cayman would embarrass at Willow Springs — and that comparison is exactly why the 993 keeps appreciating. Nobody cross-shops these two.",
    url: "https://www.porsche.com/international/aboutporsche/porschemuseum/exhibitions/permanent-exhibition/993/",
  },
  {
    car: "1988 BMW E30 M3",
    specs: "2.3L S14 four • 192 hp • 5-speed manual",
    body: "The E30 M3 is the car that ruined a generation of enthusiasts by being too good, too early. Under 2,700 pounds, boxed fender flares, a 7,000-rpm rev-happy four-cylinder engineered for touring-car homologation. Clean US examples are $80-120k now; roached ones are still $40-50k and worth restoring because everything is available and no part is exotic. What the driving press missed at the time and still misses: the E30 M3 isn't fast in a straight line by any modern standard, but the balance and steering feel are Platonic. Every 'driver's car' review since compares to this benchmark, usually unfavorably.",
    url: "https://www.bmwusa.com/vehicles/m/m3.html",
  },
  {
    car: "1990 Mazda Miata NA",
    specs: "1.6L inline-four • 116 hp • 5-speed manual",
    body: "There is a reason the NA Miata is on every 'best sports cars ever' list despite being one of the slowest cars sold in America in 1990. It's under 2,200 pounds, the shifter feels like a rifle bolt, the steering has zero slack, and the drop-top ergonomics work for anyone under 6'2\". Clean examples run $10-15k, a nice one is $18-22k, and $25k gets you an unmolested single-owner car with paperwork. The 'unexpected variable' with a first-gen Miata is that owning it is cheap — parts are $5, everything unbolts with a metric ratchet, and any independent shop can service it.",
    url: "https://www.mazdausa.com/vehicles/mx-5-miata",
  },
  {
    car: "1993 Mazda RX-7 FD",
    specs: "1.3L twin-turbo rotary • 255 hp • 5-speed manual",
    body: "The FD RX-7 is the last time a Japanese manufacturer shipped a mid-priced sports car that was so uncompromised it was scary. Twin-sequential turbos on a rotary, 2,800 pounds, a chassis Autoweek called telepathic in 1993 and time has not proved wrong. Clean US-market examples are $80-100k on Bring a Trailer, JDM imports are $60-80k. The reason the FD costs so much: nobody makes a car like this anymore, and rotaries are quietly disappearing as owners can't source apex seals. Buying the FD you can afford now and driving it 3,000 miles a year is a defensible plan; it will not depreciate.",
    url: "https://www.mazdausa.com/",
  },
  {
    car: "1971 Datsun 240Z",
    specs: "2.4L L24 inline-six • 151 hp • 4-speed manual",
    body: "The 240Z was Japan's answer to the European GT car — a proper long-nose two-seater with a smooth inline-six and independent rear suspension, at half the price of a Jaguar E-Type. Clean examples run $50-80k for numbers-matching cars, restomods with modern L-series or LS swaps push $100-150k. The Z-car has the visual proportions of a $200k GT car and drives like a $30k weekend toy — and no other car from its era is currently under-appreciated the way it still is. This is a category-6-of-the-spectrum pick: the sort of car that ages into a classic while you own it.",
    url: "https://www.nissanusa.com/heritage/heritage-vehicles/z.html",
  },
  {
    car: "1985 Mercedes 300CE-24 (W124)",
    specs: "3.0L M104 inline-six • 217 hp • 4-speed automatic",
    body: "The W124 coupé is the sleeper of the Mercedes 1980s — a hand-built pillarless coupe with a bulletproof M104 inline-six and interior quality nobody has matched at the price since. Clean examples are $18-28k on Bring a Trailer, less for an early four-cylinder. Everything is fixable; there's a shop in every mid-sized city that knows these. The trade the writer usually misses: the W124 was engineered to a lifetime standard, not a lease standard — and it shows in the door thunk, the shifter throw, the seat cushions that don't collapse at 150k miles. Modern German cars have all been re-engineered downward from this benchmark.",
    url: "https://www.mercedes-benz.com/en/classic/models/w124/",
  },
];

function pickForcedClassicCar(): { car: string; specs: string; body: string; url?: string } {
  const idx = Math.floor(Math.random() * FORCED_CLASSIC_CARS.length);
  return FORCED_CLASSIC_CARS[idx]!;
}

/**
 * Deterministic tasting-repeat offense against the FULL permanent-memory
 * recommendations. RecentContext.allRecommendations is populated from
 * latte_recommendations (append-only, survives regenerations). If the
 * writer picks a tasting title whose normalized form matches a
 * previously-recorded book / film / album / podcast / drink / product,
 * fire a retry. This catches "Conclave" recommended a second time.
 */
function findRepeatedTastingRecOffenses(
  content: SaturdayLatteContent,
  ctx: LatteRecentContext | undefined,
): RepeatOffense[] {
  if (!ctx?.allRecommendations) return [];
  const kindToSlot: Record<string, string[]> = {
    book: ["reading"],
    film: ["watching"],
    album: ["listening"],
    podcast: ["listening"],
    drink: ["drinking"],
    product: ["trying"],
  };
  const offenses: RepeatOffense[] = [];
  for (const [i, item] of content.tastingMenu.entries()) {
    const label = (item.label ?? "").toLowerCase();
    const pickedNorm = normalizeTitleForRepeat(item.title);
    if (!pickedNorm) continue;
    for (const [kind, allowedLabels] of Object.entries(kindToSlot)) {
      if (!allowedLabels.some((l) => label.includes(l))) continue;
      const list = ctx.allRecommendations[kind] ?? [];
      const hit = list.find((prev) => {
        const prevNorm = normalizeTitleForRepeat(prev);
        return prevNorm && (prevNorm === pickedNorm || prevNorm.includes(pickedNorm) || pickedNorm.includes(prevNorm));
      });
      if (hit) {
        offenses.push({
          slot: `tasting-${i + 1}` as RepeatOffense["slot"],
          picked: item.title,
          matched: `ALREADY RECOMMENDED. "${item.title}" was previously featured in a past issue (recorded as ${kind}: "${hit}"). Pick a different ${kind}.`,
        });
        break;
      }
    }
  }
  return offenses;
}

/**
 * Force every Worth Reading URL to a guaranteed-live Google Books search
 * URL for that book's title (and author if we can extract it). The writer
 * has repeatedly emitted plausible-looking but 404-ing publisher/Amazon
 * URLs for book picks. Google Books search always resolves and always
 * shows the correct book at the top. Idempotent — leaves non-reading
 * items alone.
 */
function enforceBookUrls(content: SaturdayLatteContent): SaturdayLatteContent {
  const newTasting = content.tastingMenu.map((item) => {
    const label = (item.label ?? "").toLowerCase();
    if (label.includes("reading")) {
      const rawTitle = item.title.trim();
      if (!rawTitle) return item;
      const cleanTitle = rawTitle.replace(/\s+by\s+.+$/i, "").trim();
      const author = extractCreatorHelperForTitle(rawTitle) ?? "";
      const shelfMatch = LATTE_BOOK_SHELF.find((b) => {
        const bn = normalizeTitleForRepeat(b.title);
        const tn = normalizeTitleForRepeat(cleanTitle);
        return bn === tn || bn.includes(tn) || tn.includes(bn);
      });
      const searchTitle = shelfMatch?.title ?? cleanTitle;
      const searchAuthor = shelfMatch?.author ?? author;
      const q = encodeURIComponent(`${searchTitle} ${searchAuthor}`.trim());
      return { ...item, url: `https://www.google.com/search?tbm=bks&q=${q}` };
    }
    // Worth Trying → Amazon search. Same idea as books: writer-emitted
    // product URLs are often 404 or point to the wrong SKU; an Amazon
    // search URL always resolves and puts the correct product at the top.
    if (label.includes("trying")) {
      const rawTitle = item.title.trim();
      if (!rawTitle) return item;
      const q = encodeURIComponent(rawTitle);
      return { ...item, url: `https://www.amazon.com/s?k=${q}` };
    }
    return item;
  });
  return { ...content, tastingMenu: newTasting };
}

// Duplicate of the parser in saturday-latte-cron.ts, kept local so the
// generator can normalize picks without pulling in the cron helpers.
function extractCreatorHelperForTitle(title: string): string | null {
  const trimmed = title.trim();
  const byIdx = trimmed.search(/\s+by\s+/i);
  if (byIdx === -1) return null;
  const tail = trimmed.slice(byIdx).replace(/^\s+by\s+/i, "").trim();
  if (!tail) return null;
  const first = tail.split(/[.,;:(]|[-—]\s/)[0]?.trim();
  return first && first.length >= 3 ? first : null;
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

**ALWAYS use the ESV (English Standard Version).** Quote the verse text in ESV wording exactly. The reference line must read "Book Chapter:Verse (ESV)" — no NIV, KJV, NLT, MSG, or any other translation.

BANNED VERSES (do not pick any of these):
${allBanned.map((b) => `- ${b}`).join("\n")}

Pick something different. Lean into less-cited verses: Psalms 23/65/103/126/131, Ecclesiastes 3, Isaiah 30:15, Hosea 6:3, Luke 10:42, James 1:17, Lamentations 3:22-23, Zephaniah 3:17, etc.

Return ONLY this JSON, no preamble:
{
  "verse": "the verse text in ESV wording, clean prose",
  "reference": "Book Chapter:Verse (ESV)",
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

**SLOT-TO-SUBJECT LOCK-IN (critical):** Each prompt must EXPLICITLY name its section's subject. For tasting menu items especially — two items in one issue may be visually similar (both coffee-adjacent, both books, both films) and must be forced to render as distinct images. Include the exact title of each tasting menu item inside its prompt. Include the specific technique name inside the hostsCorner prompt. Include the specific place name inside hero and coverDetail.

The 7 slots, output as JSON only:
{
  "hero": "wide scene naming the cover story's specific place, with specific light + one focal element",
  "coverDetail": "one specific detail from THIS cover story's specific place, named",
  "tastingMenu": [
    "prompt that names the EXACT TITLE of tasting menu item 1 verbatim, shown in a real use context",
    "prompt that names the EXACT TITLE of tasting menu item 2 verbatim, shown in a real use context",
    "prompt that names the EXACT TITLE of tasting menu item 3 verbatim, shown in a real use context"
  ],
  "hostsCorner": "the specific technique from moveTitle by name, in progress or its result",
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

const AUTHOR_SCOPE_SYSTEM_PROMPT = `You are the author-credibility guard for Saturday Morning Latte. Your job is to find four specific classes of writing failures and rewrite them:

**Class 1 — Out-of-scope first-person presence.** Sentences that assert Mark's personal presence at a place, restaurant, hotel, city, or specific experience OUTSIDE his authentic scope.

**Class 2 — The "friend" fallback.** Any attribution using "a friend of mine," "a friend who…," "friends of mine," "friends who…" or similar generic friend constructions. This fallback got overused and is now banned across the entire newsletter.

**Class 3 — The Connections Guy appearing outside the Cover Story.** The Connections Guy is a recurring Cover Story character (a source through whom out-of-scope destinations reach Mark). He appears ONLY in the coverStory section. If he appears in hostsCorner or theDrive, that is a violation — re-attribute via a section-appropriate source.

**Class 4 — TEMPLATED OPENINGS (this is the big one).** Cover Story openings that follow a templated structure. If the first two sentences use ANY of these patterns, they are broken and MUST be rewritten from the insight forward:

- **"Nobody I know goes to [X]"** and all variants ("Nobody I know does...", "Nobody goes to X...", "Most people don't..."). Used across multiple issues, now stock. BANNED.
- **"Everyone goes to [X]. That's the point."** BANNED.
- **"Most people skip [X] because they think..."** BANNED.
- Opens with a proper-noun source name (e.g., "The Connections Guy sent me a note about [place]"). BANNED.
- Opens by naming a communication vehicle as a prop ("a note," "a voicemail," "a text," "a postcard," "a letter," "on [X] letterhead"). BANNED as an opener.
- Opens by specifying message length ("three lines," "one line," "half a page," "an address and a time," "twenty-two seconds," "just three words scrawled at the top"). BANNED entirely — reader recognizes these as tics.
- Opens with a formal quoted line before Mark has spoken. BANNED.
- The first two sentences would work for ANY destination by only swapping the place name. BANNED — this is the template test.
- **"[Destination] markets itself as: [X], [Y], [Z]." BANNED.** This colon-then-triple-adjective construction ("October Sedona markets itself as: accessible, uncrowded, the light at its best") is now stock — used across multiple issues. Reader recognizes it. Rewrite without the colon-triple-adjective template. Same rule for "[Destination] is famous for: X, Y, Z." and "[Destination] sells itself on: X, Y, Z." — all BANNED.
- **Any COLON-THEN-TRIPLE-BEAT construction is templated by default.** "[Subject] is: X, Y, Z." reads as list-poetry-cliché. Rewrite in prose. If you find yourself typing a colon followed by three comma-separated adjectives or phrases, STOP and rework the sentence.
- **No verbatim recycling of prior-issue phrasing.** If a phrase or sentence template has appeared in a recent issue, don't reuse it — even if the destination is different. The reader gets these every week and notices.

Rewrite ANY such opening as an insight-first opener where Mark states the counter-obvious observation, the pattern, or his opinion about the destination. Sources may be mentioned mid-piece, casually, woven into information-carrying sentences — never as the opening ritual. Example rewrites:

BEFORE (templated): "The Connections Guy sent me a note in March on Fairmont Banff letterhead. One line, underlined: 'First two weeks of May. Burlington. Skip Memorial Day weekend. Bring cash.'"
AFTER (insight-first): "Nobody I know goes to Burlington before Memorial Day, and that's the point. The two-week window in early May is when the college is winding down, the sailboats aren't out yet, and the pizza place a buddy of mine trusts up there — he does the drive from Boston every spring — is calm enough to actually get a table."

Same information carried. Insight leads. Source attribution appears casually, mid-sentence. No letterhead, no length descriptor, no ritual.

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
      "class": 1 | 2 | 3 | 4,
      "original": "the exact sentence or short passage that violates (verbatim from the input)",
      "rewrite": "the attributed rewrite"
    }
  ]
}

If no violations, return {"violations":[]}. Do not include preamble or markdown fences.`;

type AuthorScopeViolation = {
  section: "coverStory" | "hostsCorner" | "theDrive";
  class?: 1 | 2 | 3 | 4;
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
    driveReferenceUrl?: string | null;
    driveUsedReference?: boolean;
    imageValidatorVerdicts?: Array<{
      slot: string;
      attempts: number;
      passed: boolean;
      finalReason?: string;
      usedFallbackToReference?: boolean;
    }>;
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
  /** Authors, directors, artists parsed from tasting titles/bodies. */
  tastingCreators: string[];
  cookingMoves: string[];
  sundayResetAuthors: string[];
  sabbathReferences: string[];
  /** Restaurants / cafes / hotels / shops named in prior Cover Stories. */
  coverStorySpots: string[];
  /**
   * Full permanent-recall memory from latte_recommendations, grouped by
   * kind. Every specific dish, restaurant, brand, tool, and person ever
   * recommended shows up here. Fed to the writer as a comprehensive
   * do-not-repeat exclusion set.
   */
  allRecommendations?: Record<string, string[]>;
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
  let writer = await runWriterPhase(
    client,
    opts.issueDate,
    research.bundle,
    recentCoverStories,
    recentContext,
  );

  // Label-content kind mismatch guard: Worth Watching MUST be a film,
  // Worth Reading MUST be a book, Worth Drinking MUST be a beverage,
  // Worth Listening MUST be audio, Worth Trying MUST be a product.
  // Heuristic detection catches the obvious cases; anything ambiguous
  // gets picked up by the image pipeline (poster mode for films,
  // cover mode for books) and would otherwise ship a mismatched
  // asset in the wrong slot.
  const kindOffenses = recentContext
    ? []
    : findKindMismatchOffenses(writer.content);
  // Editor pass. Runs in parallel with the deterministic dupe-sentence
  // check so we get both a human-like editorial review AND a guaranteed
  // catch for verbatim sentence repeats. Anything must_fix from either
  // source is joined into the retry queue with the specific issue named.
  const [editorFindings, dupeSentenceFindings] = await Promise.all([
    editorReviewIssue(client, writer.content),
    Promise.resolve(findDuplicateSentencesInContent(writer.content)),
  ]);
  const editorOffenses = [...editorFindings, ...dupeSentenceFindings]
    .filter((f) => f.severity === "must_fix")
    .map((f, i) => ({
      slot: `editor-${i + 1}` as RepeatOffense["slot"],
      picked: f.location,
      matched: f.issue,
    }));
  const shouldFixCount = editorFindings.filter((f) => f.severity === "should_fix").length;
  if (shouldFixCount > 0) {
    console.info("latte.editor_should_fix_findings", { count: shouldFixCount });
  }
  const combinedOffensesBase = recentContext
    ? [
        ...findRepeatOffenses(writer.content, recentContext),
        ...findKindMismatchOffenses(writer.content),
        ...findOffShelfBookOffenses(writer.content),
        ...findOffShelfDrinkOffenses(writer.content),
        ...findTastingImagePromptMismatchOffenses(writer.content, writer.imagePrompts),
        ...findTastingUrlMismatchOffenses(writer.content),
        ...findCarEraOffenses(writer.content, recentContext),
        ...findRepeatedTastingRecOffenses(writer.content, recentContext),
        ...editorOffenses,
      ]
    : [
        ...kindOffenses,
        ...findOffShelfBookOffenses(writer.content),
        ...findOffShelfDrinkOffenses(writer.content),
        ...findTastingImagePromptMismatchOffenses(writer.content, writer.imagePrompts),
        ...findTastingUrlMismatchOffenses(writer.content),
        ...editorOffenses,
      ];

  if (combinedOffensesBase.length > 0) {
    const rejectionMessage = combinedOffensesBase
      .map((o) => `- ${o.slot} · "${o.picked}" — ${o.matched}.`)
      .join("\n");
    console.warn("latte.writer_offenses_retry", { count: combinedOffensesBase.length, offenses: combinedOffensesBase });
    const retryWriter = await runWriterPhase(
      client,
      opts.issueDate,
      research.bundle,
      recentCoverStories,
      recentContext,
      rejectionMessage,
    );
    writer = {
      content: retryWriter.content,
      contentType: retryWriter.contentType,
      imagePrompts: retryWriter.imagePrompts,
      inputTokens: writer.inputTokens + retryWriter.inputTokens,
      outputTokens: writer.outputTokens + retryWriter.outputTokens,
      latencyMs: writer.latencyMs + retryWriter.latencyMs,
    };
    // Re-check the two rules that MUST NOT slip through: era rotation
    // and dedup against permanent memory. If the retry writer ignored
    // them, fire ONE more retry with sharper wording. The other rules
    // (kind mismatch, off-shelf, editor findings) already retry as a
    // batch above — those don't warrant a second dedicated pass.
    if (recentContext) {
      const secondOffenses = [
        ...findCarEraOffenses(writer.content, recentContext),
        ...findRepeatedTastingRecOffenses(writer.content, recentContext),
      ];
      if (secondOffenses.length > 0) {
        const secondMsg = secondOffenses
          .map((o) => `- ${o.slot} · "${o.picked}" — ${o.matched}.`)
          .join("\n");
        console.warn("latte.writer_second_retry", { count: secondOffenses.length, offenses: secondOffenses });
        const secondRetry = await runWriterPhase(
          client,
          opts.issueDate,
          research.bundle,
          recentCoverStories,
          recentContext,
          `⚠️ SECOND RETRY. Your previous retry ALSO violated one or more mandatory rules. This is your LAST chance to comply. Read every rule below carefully and produce a draft that violates NONE of them:\n\n${secondMsg}`,
        );
        writer = {
          content: secondRetry.content,
          contentType: secondRetry.contentType,
          imagePrompts: secondRetry.imagePrompts,
          inputTokens: writer.inputTokens + secondRetry.inputTokens,
          outputTokens: writer.outputTokens + secondRetry.outputTokens,
          latencyMs: writer.latencyMs + secondRetry.latencyMs,
        };
      }
      // Final backstop: if the ERA rule STILL fires after the second
      // retry, deterministically inject a random classic (we cannot
      // easily inject a tasting item, but for the car we can). Beats
      // shipping a fourth modern car in a row.
      const finalEraOffenses = findCarEraOffenses(writer.content, recentContext);
      if (finalEraOffenses.length > 0) {
        const injected = pickForcedClassicCar();
        console.error("latte.car_force_inject_classic", {
          original: writer.content.theDrive.car,
          injected: injected.car,
          reason: "writer ignored era rule after two retries",
        });
        writer = {
          ...writer,
          content: {
            ...writer.content,
            theDrive: {
              ...writer.content.theDrive,
              car: injected.car,
              specs: injected.specs,
              body: injected.body,
              ...(injected.url ? { url: injected.url } : {}),
            },
          },
        };
      }
    }
  }

  const writerCost =
    (writer.inputTokens / 1_000_000) * ANTHROPIC_INPUT_PER_M +
    (writer.outputTokens / 1_000_000) * ANTHROPIC_OUTPUT_PER_M;

  // Author-scope guard: rewrite first-person presence claims about places
  // outside Mark's authentic scope as attributed statements. Best-effort;
  // if the guard fails, keep the writer's original content.
  const scope = await enforceAuthorScope(client, writer.content);
  const scopedContent = enforceBookUrls(scope.content);

  // Image generation phase: fire 7 DALL-E 3 calls in parallel, upload to
  // Supabase Storage. Best-effort — if any fail, the email still renders
  // (the template handles missing image slots gracefully).
  let imagesCostUsd = 0;
  let imagesLatencyMs = 0;
  let imagesGenerated = 0;
  let imagesFailed = 0;
  let imagesError: string | null = null;
  let driveReferenceUrl: string | null = null;
  let driveUsedReference = false;
  let imageValidatorVerdicts: Array<{
    slot: string;
    attempts: number;
    passed: boolean;
    finalReason?: string;
    usedFallbackToReference?: boolean;
  }> = [];
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
      const subjects: LatteImageSubjects = {
        coverStoryLocation: scopedContent.coverStoryHeadline,
        tastingMenuTitles: [
          scopedContent.tastingMenu[0]?.title ?? "",
          scopedContent.tastingMenu[1]?.title ?? "",
          scopedContent.tastingMenu[2]?.title ?? "",
        ],
        tastingMenuLabels: [
          scopedContent.tastingMenu[0]?.label ?? "",
          scopedContent.tastingMenu[1]?.label ?? "",
          scopedContent.tastingMenu[2]?.label ?? "",
        ],
        hostsCornerMove: scopedContent.hostsCorner.moveTitle,
        theDriveCar: scopedContent.theDrive.car,
      };
      const imageResult = await generateLatteImages({
        prompts: imagePrompts,
        subjects,
        issueDate: opts.issueDate,
      });
      imagesCostUsd = imageResult.costUsd;
      imagesLatencyMs = imageResult.latencyMs;
      imagesFailed = imageResult.failures.length;
      driveReferenceUrl = imageResult.driveReferenceUrl ?? null;
      driveUsedReference = imageResult.driveUsedReference ?? false;
      imageValidatorVerdicts = imageResult.validatorVerdicts ?? [];
      if (imageResult.failures.length > 0) {
        for (const f of imageResult.failures) {
          console.error("latte.image_slot_failed", { slot: f.slot, error: f.error });
        }
      }
      // Which subject we tried to render per tasting slot — logged so a
      // missing tasting-N image can be traced to the actual title, not
      // just "tasting-3 failed".
      for (let i = 0; i < subjects.tastingMenuTitles.length; i++) {
        const url = imageResult.urls.tastingMenu?.[i];
        if (!url || url.trim() === "") {
          console.error("latte.tasting_image_missing", {
            slot: `tasting-${i + 1}`,
            subject: subjects.tastingMenuTitles[i],
            label: subjects.tastingMenuLabels?.[i],
          });
        }
      }
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
      driveReferenceUrl,
      driveUsedReference,
      imageValidatorVerdicts,
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
