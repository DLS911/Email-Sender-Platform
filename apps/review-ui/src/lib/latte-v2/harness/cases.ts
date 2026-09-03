/**
 * v0 harness case fixtures. Seeded from the Part 11 failure list in
 * the image-system-dump. Each case is deterministic — same subject,
 * same slotPrompt, same visualFacts — so scores across runs are
 * directly comparable.
 *
 * To add a case: append to CASES. To edit a case's expected pass
 * threshold: update `minScore`. Baseline snapshot lives in
 * harness/baseline.json (written by the run-harness driver).
 */

import type { V2Slot, V2ValidatorContext } from "../validator";

export type HarnessCase = {
  id: string;
  slot: V2Slot;
  subject: string;
  slotPrompt: string;
  /** Optional visualFacts injected into the validator context. */
  visualFacts?: V2ValidatorContext["visualFacts"];
  /** For tasting slots that need it. */
  tastingKind?: "book" | "film" | "product" | "drink" | "unknown";
  /** For hostsCorner slots that use cookware continuity. */
  hostsCornerBody?: string;
  linkedProductTitle?: string;
  /** Reference to the historical failure this case replays. */
  provenance: string;
  /** Minimum score we want from the winner. 70 is the ship threshold. */
  minScore: number;
};

export const CASES: HarnessCase[] = [
  // -----------------------
  // CAR failures (theDrive)
  // -----------------------
  {
    id: "car-g87-m2",
    slot: "theDrive",
    subject: "2024 BMW M2 (G87)",
    slotPrompt:
      "2024 BMW M2 (G87 generation, 2023+) in Zandvoort Blue Metallic parked at a coastal Florida marina at 7:30am. Squared-off boxy fender flares, slim horizontal laser LED headlights with hexagonal DRLs, quad rectangular exhaust tips, off-center rule-of-thirds composition.",
    visualFacts: {
      generationCode: "G87",
      features: [
        "squared-off boxy fender flares",
        "slim horizontal laser LED headlights",
        "hexagonal daytime running lights",
        "tall vertical BMW kidney grille in body color",
        "quad rectangular exhaust tips",
      ],
    },
    provenance: "Part 11 #1 — G87 M2 rendered as F87 repeatedly",
    minScore: 70,
  },
  {
    id: "car-f1-lm",
    slot: "theDrive",
    subject: "1995 McLaren F1 LM",
    slotPrompt:
      "1995 McLaren F1 LM in Papaya Orange parked at Goodwood pit lane. Wide rear wing, single center exhaust, matte magnesium wheels, low nose, no motion blur, static pose, editorial rule-of-thirds framing.",
    visualFacts: {
      features: [
        "wide rear wing (not the standard F1 body)",
        "single center exhaust (not twin round)",
        "matte magnesium wheels",
        "Papaya Orange color",
        "roof intake scoop",
      ],
    },
    provenance: "Part 11 #2 — F1 LM verifier let wing-only shot through",
    minScore: 70,
  },
  {
    id: "car-sti",
    slot: "theDrive",
    subject: "2004 Subaru Impreza WRX STI",
    slotPrompt:
      "2004 Subaru Impreza WRX STI in World Rally Blue parked at a rally-stage service park at dusk. Hood scoop, gold BBS wheels, small trunk spoiler, rally-derived design cues, natural-perspective 50mm side profile.",
    visualFacts: {
      features: [
        "large hood scoop",
        "gold BBS wheels",
        "small trunk-lid spoiler (blob-eye era)",
        "World Rally Blue paint",
        "sedan body",
      ],
    },
    provenance: "Part 11 #15 — STI front stretched by wide-angle reference",
    minScore: 70,
  },
  {
    id: "car-993-carrera",
    slot: "theDrive",
    subject: "1995 Porsche 993 Carrera",
    slotPrompt:
      "1995 Porsche 993 Carrera in Guards Red parked at a warehouse doorway with north light at 4pm. Air-cooled flat-six, teardrop headlights, wide rear fenders, five-spoke wheels, natural 50mm perspective, off-center rule-of-thirds.",
    visualFacts: {
      generationCode: "993",
      features: [
        "teardrop-shape integrated headlights (not fried-egg 996)",
        "wide rear fenders",
        "narrow front trunk",
        "air-cooled Boxster-adjacent proportions",
        "hollow-spoke Cup 1 or Turbo Twist wheels",
      ],
    },
    provenance: "Force-inject classic pool car",
    minScore: 70,
  },
  {
    id: "car-e30-m3",
    slot: "theDrive",
    subject: "1988 BMW E30 M3",
    slotPrompt:
      "1988 BMW E30 M3 in Alpinweiss parked at a European mountain pass pullout at golden hour. Boxed fender flares, motorsport aero, cross-spoke basketweave wheels, taillight and headlight of the E30 era, natural static perspective.",
    visualFacts: {
      generationCode: "E30",
      features: [
        "boxed fender flares over stock E30 sedan body",
        "quad-round headlights",
        "cross-spoke basketweave wheels",
        "motorsport trunk spoiler",
        "small hood bulge",
      ],
    },
    provenance: "Force-inject classic pool car",
    minScore: 70,
  },
  // ------------------------------
  // HOST'S CORNER failures (hostsCorner)
  // ------------------------------
  {
    id: "hc-dutch-oven-braise",
    slot: "hostsCorner",
    subject: "The Sunday Dutch-Oven Braise",
    slotPrompt:
      "A Le Creuset flame-orange enameled cast iron dutch oven with the lid off on a butcher-block counter, braised short ribs visible inside in a mahogany-brown sauce, kitchen window light at 5pm, natural falloff, off-center composition.",
    visualFacts: {
      cookware: "enameled cast iron dutch oven (Le Creuset flame orange)",
    },
    provenance: "Part 11 #25 — dutch oven with steam from closed lid",
    minScore: 70,
  },
  {
    id: "hc-smash-burger",
    slot: "hostsCorner",
    subject: "The Smash Burger Method",
    slotPrompt:
      "One thin ball of ground beef just smashed flat with a stiff metal spatula onto a screaming-hot cast iron surface. Wispy lacy crispy caramelized edges forming past the patty's original circumference, browning fond in the pan around it, no bun, no cheese, no plate — entire frame is the patty on the metal.",
    visualFacts: {
      cookware: "cast iron skillet on a gas burner",
    },
    provenance: "Part 11 #7 — smash burger rendered as generic finished cheeseburger",
    minScore: 70,
  },
  {
    id: "hc-salmon-plated",
    slot: "hostsCorner",
    subject: "The Slow-Cook Salmon",
    slotPrompt:
      "A single portion of medium-rare salmon on a small white plate over an ivory linen napkin, flaky pink flesh, crisp skin down. Kitchen window light from the left at 4pm, natural falloff. No probe, no thermometer, no cake tester, no utensil.",
    visualFacts: {
      cookware: "white ceramic plate",
    },
    provenance: "Part 11 #9 — salmon had a temp reader stuck in it",
    minScore: 70,
  },
  {
    id: "hc-wok-stirfry",
    slot: "hostsCorner",
    subject: "The Weeknight Wok Stir-Fry",
    slotPrompt:
      "A round-bottom carbon-steel wok on a wok ring over a live gas flame, dark seasoned patina, blistered charred chunks of chicken and Chinese broccoli tossed mid-action inside, wok breath visible as a small wisp of steam rising, no hands. Kitchen light warm, side window.",
    visualFacts: {
      cookware: "round-bottom carbon-steel wok on a wok ring over gas",
    },
    provenance: "Recent — wok pan continuity mismatch",
    minScore: 70,
  },
  // ----------------------------
  // TASTING failures (tastingMenu)
  // ----------------------------
  {
    id: "tasting-book-fire-next-time",
    slot: "tastingMenu-book",
    subject: "The Fire Next Time by James Baldwin",
    slotPrompt:
      `"The Fire Next Time by James Baldwin". Render this exact book — "The Fire Next Time" — lying flat on a walnut-grain table, camera looking straight down at 90 degrees, cover fills 75-80% of the frame, warm side-window light rakes across the cover from one edge, no props on the table.`,
    tastingKind: "book",
    provenance: "Part 11 #8 — book title/image/link split-brain, image was different book",
    minScore: 70,
  },
  {
    id: "tasting-book-meditations",
    slot: "tastingMenu-book",
    subject: "Meditations by Marcus Aurelius",
    slotPrompt:
      `"Meditations by Marcus Aurelius". Render this exact book — "Meditations" — lying flat on an oak table, camera straight down, cover fills 75% of the frame, warm morning window light from the left.`,
    tastingKind: "book",
    provenance: "Book shelf classic",
    minScore: 70,
  },
  {
    id: "tasting-film-conclave-poster",
    slot: "tastingMenu-film-poster",
    subject: "Conclave",
    slotPrompt:
      `"Conclave" film poster displayed in a framed portrait print on an art-house cinema lobby wall at dusk, warm interior sconce light, wall is a complete flat plaster wall with no cutouts or half-walls, poster is in portrait orientation. No other posters, no books, no TVs.`,
    tastingKind: "film",
    provenance: "Part 11 #19 — Conclave already recommended; poster route",
    minScore: 70,
  },
  {
    id: "tasting-product-fellow-opus",
    slot: "tastingMenu-product",
    subject: "Fellow Opus Conical Burr Grinder",
    slotPrompt:
      `"Fellow Opus Conical Burr Grinder". Render this exact grinder — Fellow Opus in matte black — sitting cleanly on a butcher-block counter, morning window light from the left, subtle depth of field, no coffee beans on the counter, no props.`,
    tastingKind: "product",
    provenance: "Part 11 #23 — Fellow Opus shipped as raw white catalog photo",
    minScore: 70,
  },
  {
    id: "tasting-drink-smith-cross",
    slot: "tastingMenu-drink",
    subject: "Smith & Cross Jamaican Rum",
    slotPrompt:
      `"Smith & Cross Jamaican Rum". Render this exact bottle — Smith & Cross Traditional Jamaican Rum with its cream-and-red label — sitting upright at rest on a weathered oak bar top, warm bar-lamp light from the right, an empty rocks glass alongside on the left. No watermark, no debris.`,
    tastingKind: "drink",
    provenance: "Part 11 #22 — rum bottle had watermark baked in",
    minScore: 70,
  },
  // -----------------------------
  // HERO / COVER DETAIL failures
  // -----------------------------
  {
    id: "hero-kaikoura-whales",
    slot: "hero",
    subject: "Kaikōura, New Zealand",
    slotPrompt:
      "Kaikōura, New Zealand at 7am — the Seaward Kaikōura mountain range rising sharply behind the town, snow on the upper ridges, a low-cloud band clearing over the Pacific in front, the peninsula's rocky reef visible in the foreground with textured wind-broken water. Ektar 100 landscape look, off-center rule-of-thirds, no people.",
    visualFacts: {
      landmarks: [
        "Seaward Kaikōura Range: snow-capped ridges rising sharply behind the town",
        "Kaikōura Peninsula rocky reef",
        "Pacific Ocean fetch",
      ],
      signatureSubject: "sperm whales / humpback whale flukes at the surface",
    },
    provenance: "Part 11 #24 — Kaikōura had no whale image",
    minScore: 70,
  },
  {
    id: "coverdetail-kaikoura-whale",
    slot: "coverDetail",
    subject: "Kaikōura, New Zealand",
    slotPrompt:
      "A sperm whale fluke rising above the surface of the Pacific about 200m off Kaikōura, backlit by afternoon sun, small whale-watching boat visible in the mid-frame for scale, textured wind-broken water, no crowds, natural editorial framing.",
    visualFacts: {
      landmarks: ["Kaikōura Peninsula waterline"],
      signatureSubject: "sperm whale fluke at the surface",
    },
    provenance: "Part 11 #24 — coverDetail must feature the signature subject",
    minScore: 70,
  },
  {
    id: "coverdetail-obidos-street",
    slot: "coverDetail",
    subject: "Óbidos, Portugal",
    slotPrompt:
      "The medieval whitewashed lanes inside the walls of Óbidos at 8am in early November, worn cobblestones still wet from overnight rain, low autumn sun raking across a blue-trimmed doorway, bougainvillea still holding late blooms. No crowd, one distant figure at most.",
    visualFacts: {
      landmarks: [
        "walled medieval town of Óbidos",
        "whitewashed houses with blue and yellow trim",
        "cobblestone lanes inside the walls",
      ],
    },
    provenance: "Recent — coverDetail wants scenic, not detail crop",
    minScore: 70,
  },
];

export function getCaseById(id: string): HarnessCase | null {
  return CASES.find((c) => c.id === id) ?? null;
}

export function listCaseIds(): string[] {
  return CASES.map((c) => c.id);
}
