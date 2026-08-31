/**
 * Curated Saturday Morning Latte drink shelf.
 *
 * Same architecture as the book shelf: the writer picks Worth Drinking
 * from this list by default rather than defaulting to whatever bourbon
 * is currently trending in research. Solves the "Redwood Empire /
 * Elmer T Lee / Wild Turkey shows up every third week" problem.
 *
 * Spread across categories on purpose — bourbon is one column of many,
 * not the safe default. Writer's category-rotation rule in the prompt
 * combined with this shelf keeps variety high.
 *
 * All items are real, reasonably findable, and drinkable by an adult
 * with taste. No obscure allocated whiskeys that nobody can buy. No
 * cliché "you already know this" mass-market picks.
 */

export type ShelfDrink = {
  title: string;
  category:
    | "bourbon"
    | "rye"
    | "scotch"
    | "irish-whiskey"
    | "japanese-whisky"
    | "tequila-mezcal"
    | "rum"
    | "gin"
    | "vodka"
    | "wine-red"
    | "wine-white"
    | "wine-rose-sparkling"
    | "natural-wine"
    | "fortified-aperitif"
    | "amaro-digestif"
    | "beer"
    | "cider"
    | "cocktail"
    | "non-alcoholic"
    | "coffee-bean"
    | "tea";
};

export const LATTE_DRINK_SHELF: ShelfDrink[] = [
  // Bourbon
  { title: "Four Roses Small Batch Select", category: "bourbon" },
  { title: "Wild Turkey Rare Breed", category: "bourbon" },
  { title: "Heaven Hill Bottled-in-Bond 7 Year", category: "bourbon" },
  { title: "Buffalo Trace", category: "bourbon" },
  { title: "Weller Special Reserve", category: "bourbon" },
  { title: "Maker's Mark 46", category: "bourbon" },
  { title: "Larceny Barrel Proof", category: "bourbon" },
  { title: "Russell's Reserve 10 Year", category: "bourbon" },

  // Rye
  { title: "Rittenhouse Rye Bottled-in-Bond", category: "rye" },
  { title: "Sazerac Rye", category: "rye" },
  { title: "Pikesville 6 Year Rye", category: "rye" },
  { title: "Willett Family Estate Rye", category: "rye" },
  { title: "High West Double Rye", category: "rye" },

  // Scotch
  { title: "Highland Park 12", category: "scotch" },
  { title: "Springbank 10", category: "scotch" },
  { title: "Talisker 10", category: "scotch" },
  { title: "Lagavulin 16", category: "scotch" },
  { title: "Glenfarclas 15", category: "scotch" },
  { title: "Compass Box Peat Monster", category: "scotch" },
  { title: "Glenmorangie 18 Year", category: "scotch" },

  // Irish
  { title: "Redbreast 12", category: "irish-whiskey" },
  { title: "Green Spot", category: "irish-whiskey" },
  { title: "Powers John's Lane", category: "irish-whiskey" },

  // Japanese
  { title: "Nikka From The Barrel", category: "japanese-whisky" },
  { title: "Suntory Toki", category: "japanese-whisky" },
  { title: "Nikka Coffey Grain", category: "japanese-whisky" },

  // Tequila / mezcal
  { title: "Fortaleza Blanco", category: "tequila-mezcal" },
  { title: "Siete Leguas Blanco", category: "tequila-mezcal" },
  { title: "Tequila Ocho Plata", category: "tequila-mezcal" },
  { title: "Del Maguey Vida", category: "tequila-mezcal" },
  { title: "Mezcal Vago Elote", category: "tequila-mezcal" },
  { title: "Clase Azul Reposado", category: "tequila-mezcal" },

  // Rum
  { title: "Smith & Cross Traditional Jamaica Rum", category: "rum" },
  { title: "Plantation Xaymaca Special Dry", category: "rum" },
  { title: "Diplomático Reserva Exclusiva", category: "rum" },
  { title: "Appleton Estate 12", category: "rum" },
  { title: "El Dorado 15", category: "rum" },

  // Gin
  { title: "Ford's Gin", category: "gin" },
  { title: "Sipsmith London Dry", category: "gin" },
  { title: "Monkey 47", category: "gin" },
  { title: "Hendrick's", category: "gin" },
  { title: "Botanist Islay Dry", category: "gin" },

  // Wine — red
  { title: "Occhipinti SP68 Rosso (Sicily)", category: "wine-red" },
  { title: "Ridge Vineyards Geyserville", category: "wine-red" },
  { title: "Château Musar (Lebanon)", category: "wine-red" },
  { title: "Broc Cellars Love Red (California)", category: "wine-red" },
  { title: "Produttori del Barbaresco Barbaresco (Piedmont)", category: "wine-red" },
  { title: "Domaine Tempier Bandol Rouge", category: "wine-red" },
  { title: "Radikon Ribolla Gialla (Friuli, macerated)", category: "wine-red" },

  // Wine — white
  { title: "Domaine Huet Vouvray Sec", category: "wine-white" },
  { title: "Foillard Beaujolais Blanc", category: "wine-white" },
  { title: "Movia Ribolla (Slovenia)", category: "wine-white" },
  { title: "Domaine Weinbach Riesling Cuvée Théo", category: "wine-white" },
  { title: "Enderle & Moll Riesling", category: "wine-white" },
  { title: "Prá Otto Soave Classico", category: "wine-white" },

  // Rosé / sparkling
  { title: "Chateau Simone Palette Rosé", category: "wine-rose-sparkling" },
  { title: "Bandol Rosé (Domaine Tempier)", category: "wine-rose-sparkling" },
  { title: "Vouette et Sorbée Blanc d'Argile (grower Champagne)", category: "wine-rose-sparkling" },
  { title: "Camille Braun Crémant d'Alsace", category: "wine-rose-sparkling" },
  { title: "Ca' del Bosco Franciacorta Cuvée Prestige", category: "wine-rose-sparkling" },

  // Natural / low-intervention
  { title: "Frank Cornelissen Susucaru", category: "natural-wine" },
  { title: "Domaine Marcel Lapierre Morgon", category: "natural-wine" },
  { title: "COS Cerasuolo di Vittoria", category: "natural-wine" },
  { title: "Meinklang Prosa (Austria pét-nat)", category: "natural-wine" },

  // Fortified / aperitif
  { title: "Cocchi Americano", category: "fortified-aperitif" },
  { title: "Lillet Blanc", category: "fortified-aperitif" },
  { title: "Alessio Vermouth Bianco", category: "fortified-aperitif" },
  { title: "Dolin Blanc Vermouth de Chambéry", category: "fortified-aperitif" },
  { title: "Bordiga Sweet Vermouth", category: "fortified-aperitif" },
  { title: "Manzanilla Sherry (Hidalgo La Gitana)", category: "fortified-aperitif" },
  { title: "Fino Sherry (Tio Pepe)", category: "fortified-aperitif" },

  // Amaro / digestif
  { title: "Amaro Nonino Quintessentia", category: "amaro-digestif" },
  { title: "Amaro Meletti", category: "amaro-digestif" },
  { title: "Fernet-Branca", category: "amaro-digestif" },
  { title: "Cynar", category: "amaro-digestif" },
  { title: "Braulio", category: "amaro-digestif" },
  { title: "Averna", category: "amaro-digestif" },

  // Beer
  { title: "Suarez Family Palatine Pils", category: "beer" },
  { title: "Sierra Nevada Pale Ale", category: "beer" },
  { title: "Orval Trappist Ale", category: "beer" },
  { title: "Saison Dupont", category: "beer" },
  { title: "Alesmith Speedway Stout", category: "beer" },
  { title: "Firestone Walker Pivo Pils", category: "beer" },
  { title: "Guinness Draught (Ireland)", category: "beer" },
  { title: "Founders Breakfast Stout", category: "beer" },

  // Cider
  { title: "Eve's Cidery Autumn's Gold (Finger Lakes)", category: "cider" },
  { title: "Angry Orchard Understood in Motion", category: "cider" },
  { title: "Farnum Hill Extra-Dry Cider", category: "cider" },

  // Cocktail
  { title: "Boulevardier (Rittenhouse rye + Campari + sweet vermouth)", category: "cocktail" },
  { title: "Negroni (equal-parts Beefeater + Campari + Carpano Antica)", category: "cocktail" },
  { title: "Old Fashioned (Weller Special Reserve + demerara + Angostura)", category: "cocktail" },
  { title: "Sazerac (Sazerac rye + Peychaud's + absinthe rinse)", category: "cocktail" },
  { title: "Aperol Spritz (Aperol + Prosecco + soda)", category: "cocktail" },
  { title: "Mezcal Paloma (Del Maguey Vida + grapefruit + lime)", category: "cocktail" },
  { title: "Gimlet (Ford's gin + fresh lime cordial)", category: "cocktail" },
  { title: "Corpse Reviver #2 (gin + Cocchi + Cointreau + lemon + absinthe)", category: "cocktail" },

  // Non-alcoholic
  { title: "Athletic Brewing Free Wave (NA hazy IPA)", category: "non-alcoholic" },
  { title: "Best Day Kolsch (NA)", category: "non-alcoholic" },
  { title: "Ghia Le Spritz (NA aperitif)", category: "non-alcoholic" },
  { title: "Seedlip Grove 42 (NA citrus spirit)", category: "non-alcoholic" },
  { title: "Fauna Aperitivo Rosso (NA)", category: "non-alcoholic" },
  { title: "Töst Sparkling Rosé (NA)", category: "non-alcoholic" },
  { title: "Kin Euphorics Lightwave", category: "non-alcoholic" },

  // Coffee bean
  { title: "Onyx Coffee Lab Monarch Blend", category: "coffee-bean" },
  { title: "Sey Coffee (Brooklyn) — rotating single origins", category: "coffee-bean" },
  { title: "Passenger Coffee Founder's Blend", category: "coffee-bean" },
  { title: "Verve Coffee 1950 Blend", category: "coffee-bean" },
  { title: "Stumptown Hair Bender", category: "coffee-bean" },
  { title: "Blue Bottle Bella Donovan", category: "coffee-bean" },
  { title: "Counter Culture Hologram", category: "coffee-bean" },

  // Tea
  { title: "In Pursuit of Tea Yunnan Gold", category: "tea" },
  { title: "Rare Tea Company Assam Second Flush", category: "tea" },
  { title: "Song Tea Milk Oolong", category: "tea" },
  { title: "Ippodo Sayaka Matcha", category: "tea" },
  { title: "Harney & Sons Paris (blend)", category: "tea" },
];

/** Compact, prompt-friendly listing grouped by category. */
export function drinkShelfSummaryForPrompt(): string {
  const grouped: Record<string, ShelfDrink[]> = {};
  for (const d of LATTE_DRINK_SHELF) {
    if (!grouped[d.category]) grouped[d.category] = [];
    grouped[d.category]!.push(d);
  }
  const order: ShelfDrink["category"][] = [
    "bourbon", "rye", "scotch", "irish-whiskey", "japanese-whisky",
    "tequila-mezcal", "rum", "gin", "vodka",
    "wine-red", "wine-white", "wine-rose-sparkling", "natural-wine",
    "fortified-aperitif", "amaro-digestif",
    "beer", "cider", "cocktail",
    "non-alcoholic", "coffee-bean", "tea",
  ];
  const lines: string[] = [];
  for (const cat of order) {
    const items = grouped[cat];
    if (!items || items.length === 0) continue;
    lines.push(`### ${cat.replace(/-/g, " ").toUpperCase()}`);
    for (const d of items) lines.push(`- ${d.title}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
