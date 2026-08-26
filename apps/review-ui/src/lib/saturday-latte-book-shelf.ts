/**
 * Curated Saturday Morning Latte book shelf.
 *
 * The Worth Reading slot picks from this shelf by default. Bias is
 * toward established / classic / well-reviewed titles rather than
 * whatever's trending this month — Latte readers want the books that
 * still matter, not the latest press-release novel.
 *
 * Mix:
 *   - Literary fiction (Faulkner, Morrison, McCarthy, Robinson,
 *     Dostoevsky, Tolstoy, Márquez, McEwan, Ishiguro, Franzen)
 *   - Non-fiction essays and criticism (Didion, Baldwin, Wallace)
 *   - Nature and place writing (Dillard, Berry, Abbey, Leopold,
 *     Matthiessen, Chatwin)
 *   - Memoir and biography (Wolfe, Krakauer, Vance, Junger)
 *   - Big-idea non-fiction (Kahneman, Frankl, Kuhn, Damasio)
 *   - Adventure / mountaineering / expedition (Krakauer, Junger,
 *     Lansing, Ambrose, de Saint-Exupéry)
 *
 * Most items are pre-2015. A minority of newer titles are included where
 * they have durable reputation (Robinson's Jack, Franzen's Crossroads,
 * Whitehead's Underground Railroad, Doerr's All the Light).
 *
 * Add to this shelf freely. The writer is instructed to pick from here
 * unless the destination or a research pass surfaces a compelling
 * region-specific book off-shelf.
 */

export type ShelfBook = {
  title: string;
  author: string;
  year: number;
  genre:
    | "literary-fiction"
    | "classic-fiction"
    | "non-fiction-essays"
    | "nature-writing"
    | "memoir-biography"
    | "big-idea"
    | "adventure-expedition"
    | "history"
    | "poetry";
};

export const LATTE_BOOK_SHELF: ShelfBook[] = [
  { title: "Middlemarch", author: "George Eliot", year: 1871, genre: "classic-fiction" },
  { title: "Anna Karenina", author: "Leo Tolstoy", year: 1877, genre: "classic-fiction" },
  { title: "War and Peace", author: "Leo Tolstoy", year: 1869, genre: "classic-fiction" },
  { title: "The Brothers Karamazov", author: "Fyodor Dostoevsky", year: 1880, genre: "classic-fiction" },
  { title: "Crime and Punishment", author: "Fyodor Dostoevsky", year: 1866, genre: "classic-fiction" },
  { title: "The Idiot", author: "Fyodor Dostoevsky", year: 1869, genre: "classic-fiction" },
  { title: "Moby-Dick", author: "Herman Melville", year: 1851, genre: "classic-fiction" },
  { title: "The Adventures of Huckleberry Finn", author: "Mark Twain", year: 1884, genre: "classic-fiction" },
  { title: "Great Expectations", author: "Charles Dickens", year: 1861, genre: "classic-fiction" },
  { title: "David Copperfield", author: "Charles Dickens", year: 1850, genre: "classic-fiction" },
  { title: "Bleak House", author: "Charles Dickens", year: 1853, genre: "classic-fiction" },
  { title: "Jane Eyre", author: "Charlotte Brontë", year: 1847, genre: "classic-fiction" },
  { title: "Wuthering Heights", author: "Emily Brontë", year: 1847, genre: "classic-fiction" },
  { title: "Pride and Prejudice", author: "Jane Austen", year: 1813, genre: "classic-fiction" },
  { title: "Emma", author: "Jane Austen", year: 1815, genre: "classic-fiction" },
  { title: "Persuasion", author: "Jane Austen", year: 1817, genre: "classic-fiction" },
  { title: "The Portrait of a Lady", author: "Henry James", year: 1881, genre: "classic-fiction" },
  { title: "The Age of Innocence", author: "Edith Wharton", year: 1920, genre: "classic-fiction" },
  { title: "The House of Mirth", author: "Edith Wharton", year: 1905, genre: "classic-fiction" },
  { title: "A Room With a View", author: "E. M. Forster", year: 1908, genre: "classic-fiction" },
  { title: "Howards End", author: "E. M. Forster", year: 1910, genre: "classic-fiction" },
  { title: "A Passage to India", author: "E. M. Forster", year: 1924, genre: "classic-fiction" },
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", year: 1925, genre: "classic-fiction" },
  { title: "Tender Is the Night", author: "F. Scott Fitzgerald", year: 1934, genre: "classic-fiction" },
  { title: "The Sun Also Rises", author: "Ernest Hemingway", year: 1926, genre: "classic-fiction" },
  { title: "A Farewell to Arms", author: "Ernest Hemingway", year: 1929, genre: "classic-fiction" },
  { title: "For Whom the Bell Tolls", author: "Ernest Hemingway", year: 1940, genre: "classic-fiction" },
  { title: "The Old Man and the Sea", author: "Ernest Hemingway", year: 1952, genre: "classic-fiction" },
  { title: "East of Eden", author: "John Steinbeck", year: 1952, genre: "classic-fiction" },
  { title: "The Grapes of Wrath", author: "John Steinbeck", year: 1939, genre: "classic-fiction" },
  { title: "Of Mice and Men", author: "John Steinbeck", year: 1937, genre: "classic-fiction" },
  { title: "Cannery Row", author: "John Steinbeck", year: 1945, genre: "classic-fiction" },
  { title: "The Sound and the Fury", author: "William Faulkner", year: 1929, genre: "literary-fiction" },
  { title: "As I Lay Dying", author: "William Faulkner", year: 1930, genre: "literary-fiction" },
  { title: "Light in August", author: "William Faulkner", year: 1932, genre: "literary-fiction" },
  { title: "Absalom, Absalom!", author: "William Faulkner", year: 1936, genre: "literary-fiction" },
  { title: "To the Lighthouse", author: "Virginia Woolf", year: 1927, genre: "literary-fiction" },
  { title: "Mrs Dalloway", author: "Virginia Woolf", year: 1925, genre: "literary-fiction" },
  { title: "Orlando", author: "Virginia Woolf", year: 1928, genre: "literary-fiction" },
  { title: "One Hundred Years of Solitude", author: "Gabriel García Márquez", year: 1967, genre: "literary-fiction" },
  { title: "Love in the Time of Cholera", author: "Gabriel García Márquez", year: 1985, genre: "literary-fiction" },
  { title: "The Master and Margarita", author: "Mikhail Bulgakov", year: 1967, genre: "literary-fiction" },
  { title: "Catch-22", author: "Joseph Heller", year: 1961, genre: "literary-fiction" },
  { title: "Slaughterhouse-Five", author: "Kurt Vonnegut", year: 1969, genre: "literary-fiction" },
  { title: "Cat's Cradle", author: "Kurt Vonnegut", year: 1963, genre: "literary-fiction" },
  { title: "Beloved", author: "Toni Morrison", year: 1987, genre: "literary-fiction" },
  { title: "Song of Solomon", author: "Toni Morrison", year: 1977, genre: "literary-fiction" },
  { title: "Sula", author: "Toni Morrison", year: 1973, genre: "literary-fiction" },
  { title: "The Color Purple", author: "Alice Walker", year: 1982, genre: "literary-fiction" },
  { title: "Their Eyes Were Watching God", author: "Zora Neale Hurston", year: 1937, genre: "literary-fiction" },
  { title: "Invisible Man", author: "Ralph Ellison", year: 1952, genre: "literary-fiction" },
  { title: "Native Son", author: "Richard Wright", year: 1940, genre: "literary-fiction" },
  { title: "Go Tell It on the Mountain", author: "James Baldwin", year: 1953, genre: "literary-fiction" },
  { title: "Giovanni's Room", author: "James Baldwin", year: 1956, genre: "literary-fiction" },
  { title: "Another Country", author: "James Baldwin", year: 1962, genre: "literary-fiction" },
  { title: "Blood Meridian", author: "Cormac McCarthy", year: 1985, genre: "literary-fiction" },
  { title: "All the Pretty Horses", author: "Cormac McCarthy", year: 1992, genre: "literary-fiction" },
  { title: "The Crossing", author: "Cormac McCarthy", year: 1994, genre: "literary-fiction" },
  { title: "No Country for Old Men", author: "Cormac McCarthy", year: 2005, genre: "literary-fiction" },
  { title: "The Road", author: "Cormac McCarthy", year: 2006, genre: "literary-fiction" },
  { title: "Suttree", author: "Cormac McCarthy", year: 1979, genre: "literary-fiction" },
  { title: "Housekeeping", author: "Marilynne Robinson", year: 1980, genre: "literary-fiction" },
  { title: "Gilead", author: "Marilynne Robinson", year: 2004, genre: "literary-fiction" },
  { title: "Home", author: "Marilynne Robinson", year: 2008, genre: "literary-fiction" },
  { title: "Lila", author: "Marilynne Robinson", year: 2014, genre: "literary-fiction" },
  { title: "Jack", author: "Marilynne Robinson", year: 2020, genre: "literary-fiction" },
  { title: "The Remains of the Day", author: "Kazuo Ishiguro", year: 1989, genre: "literary-fiction" },
  { title: "Never Let Me Go", author: "Kazuo Ishiguro", year: 2005, genre: "literary-fiction" },
  { title: "An Artist of the Floating World", author: "Kazuo Ishiguro", year: 1986, genre: "literary-fiction" },
  { title: "Atonement", author: "Ian McEwan", year: 2001, genre: "literary-fiction" },
  { title: "On Chesil Beach", author: "Ian McEwan", year: 2007, genre: "literary-fiction" },
  { title: "Saturday", author: "Ian McEwan", year: 2005, genre: "literary-fiction" },
  { title: "White Teeth", author: "Zadie Smith", year: 2000, genre: "literary-fiction" },
  { title: "On Beauty", author: "Zadie Smith", year: 2005, genre: "literary-fiction" },
  { title: "The Corrections", author: "Jonathan Franzen", year: 2001, genre: "literary-fiction" },
  { title: "Freedom", author: "Jonathan Franzen", year: 2010, genre: "literary-fiction" },
  { title: "Crossroads", author: "Jonathan Franzen", year: 2021, genre: "literary-fiction" },
  { title: "White Noise", author: "Don DeLillo", year: 1985, genre: "literary-fiction" },
  { title: "Underworld", author: "Don DeLillo", year: 1997, genre: "literary-fiction" },
  { title: "Libra", author: "Don DeLillo", year: 1988, genre: "literary-fiction" },
  { title: "Infinite Jest", author: "David Foster Wallace", year: 1996, genre: "literary-fiction" },
  { title: "The Broom of the System", author: "David Foster Wallace", year: 1987, genre: "literary-fiction" },
  { title: "2666", author: "Roberto Bolaño", year: 2004, genre: "literary-fiction" },
  { title: "The Savage Detectives", author: "Roberto Bolaño", year: 1998, genre: "literary-fiction" },
  { title: "The Shipping News", author: "Annie Proulx", year: 1993, genre: "literary-fiction" },
  { title: "Cold Mountain", author: "Charles Frazier", year: 1997, genre: "literary-fiction" },
  { title: "A Confederacy of Dunces", author: "John Kennedy Toole", year: 1980, genre: "literary-fiction" },
  { title: "Cutting for Stone", author: "Abraham Verghese", year: 2009, genre: "literary-fiction" },
  { title: "Lincoln in the Bardo", author: "George Saunders", year: 2017, genre: "literary-fiction" },
  { title: "All the Light We Cannot See", author: "Anthony Doerr", year: 2014, genre: "literary-fiction" },
  { title: "The Underground Railroad", author: "Colson Whitehead", year: 2016, genre: "literary-fiction" },
  { title: "The Nickel Boys", author: "Colson Whitehead", year: 2019, genre: "literary-fiction" },
  { title: "A Little Life", author: "Hanya Yanagihara", year: 2015, genre: "literary-fiction" },
  { title: "Wolf Hall", author: "Hilary Mantel", year: 2009, genre: "literary-fiction" },
  { title: "Bring Up the Bodies", author: "Hilary Mantel", year: 2012, genre: "literary-fiction" },
  { title: "The Master", author: "Colm Tóibín", year: 2004, genre: "literary-fiction" },
  { title: "Brooklyn", author: "Colm Tóibín", year: 2009, genre: "literary-fiction" },
  { title: "Stoner", author: "John Williams", year: 1965, genre: "literary-fiction" },
  { title: "Augustus", author: "John Williams", year: 1972, genre: "literary-fiction" },
  { title: "A Sand County Almanac", author: "Aldo Leopold", year: 1949, genre: "nature-writing" },
  { title: "Silent Spring", author: "Rachel Carson", year: 1962, genre: "nature-writing" },
  { title: "Desert Solitaire", author: "Edward Abbey", year: 1968, genre: "nature-writing" },
  { title: "Pilgrim at Tinker Creek", author: "Annie Dillard", year: 1974, genre: "nature-writing" },
  { title: "An American Childhood", author: "Annie Dillard", year: 1987, genre: "memoir-biography" },
  { title: "The Snow Leopard", author: "Peter Matthiessen", year: 1978, genre: "nature-writing" },
  { title: "The Peregrine", author: "J. A. Baker", year: 1967, genre: "nature-writing" },
  { title: "H is for Hawk", author: "Helen Macdonald", year: 2014, genre: "nature-writing" },
  { title: "In Patagonia", author: "Bruce Chatwin", year: 1977, genre: "nature-writing" },
  { title: "The Songlines", author: "Bruce Chatwin", year: 1987, genre: "nature-writing" },
  { title: "Arctic Dreams", author: "Barry Lopez", year: 1986, genre: "nature-writing" },
  { title: "Of Wolves and Men", author: "Barry Lopez", year: 1978, genre: "nature-writing" },
  { title: "The Unsettling of America", author: "Wendell Berry", year: 1977, genre: "nature-writing" },
  { title: "Bringing It to the Table", author: "Wendell Berry", year: 2009, genre: "nature-writing" },
  { title: "Jayber Crow", author: "Wendell Berry", year: 2000, genre: "literary-fiction" },
  { title: "Hannah Coulter", author: "Wendell Berry", year: 2004, genre: "literary-fiction" },
  { title: "The Overstory", author: "Richard Powers", year: 2018, genre: "literary-fiction" },
  { title: "Slouching Towards Bethlehem", author: "Joan Didion", year: 1968, genre: "non-fiction-essays" },
  { title: "The White Album", author: "Joan Didion", year: 1979, genre: "non-fiction-essays" },
  { title: "The Year of Magical Thinking", author: "Joan Didion", year: 2005, genre: "memoir-biography" },
  { title: "Blue Nights", author: "Joan Didion", year: 2011, genre: "memoir-biography" },
  { title: "Notes of a Native Son", author: "James Baldwin", year: 1955, genre: "non-fiction-essays" },
  { title: "The Fire Next Time", author: "James Baldwin", year: 1963, genre: "non-fiction-essays" },
  { title: "Consider the Lobster", author: "David Foster Wallace", year: 2005, genre: "non-fiction-essays" },
  { title: "A Supposedly Fun Thing I'll Never Do Again", author: "David Foster Wallace", year: 1997, genre: "non-fiction-essays" },
  { title: "Between the World and Me", author: "Ta-Nehisi Coates", year: 2015, genre: "non-fiction-essays" },
  { title: "In Cold Blood", author: "Truman Capote", year: 1966, genre: "non-fiction-essays" },
  { title: "The Right Stuff", author: "Tom Wolfe", year: 1979, genre: "memoir-biography" },
  { title: "The Electric Kool-Aid Acid Test", author: "Tom Wolfe", year: 1968, genre: "non-fiction-essays" },
  { title: "Into the Wild", author: "Jon Krakauer", year: 1996, genre: "adventure-expedition" },
  { title: "Into Thin Air", author: "Jon Krakauer", year: 1997, genre: "adventure-expedition" },
  { title: "Under the Banner of Heaven", author: "Jon Krakauer", year: 2003, genre: "non-fiction-essays" },
  { title: "The Perfect Storm", author: "Sebastian Junger", year: 1997, genre: "adventure-expedition" },
  { title: "War", author: "Sebastian Junger", year: 2010, genre: "memoir-biography" },
  { title: "Tribe", author: "Sebastian Junger", year: 2016, genre: "non-fiction-essays" },
  { title: "Endurance: Shackleton's Incredible Voyage", author: "Alfred Lansing", year: 1959, genre: "adventure-expedition" },
  { title: "Undaunted Courage", author: "Stephen E. Ambrose", year: 1996, genre: "history" },
  { title: "Wind, Sand and Stars", author: "Antoine de Saint-Exupéry", year: 1939, genre: "adventure-expedition" },
  { title: "The Long Walk", author: "Sławomir Rawicz", year: 1956, genre: "adventure-expedition" },
  { title: "Wild", author: "Cheryl Strayed", year: 2012, genre: "memoir-biography" },
  { title: "A Walk in the Woods", author: "Bill Bryson", year: 1998, genre: "adventure-expedition" },
  { title: "In a Sunburned Country", author: "Bill Bryson", year: 2000, genre: "nature-writing" },
  { title: "Zen and the Art of Motorcycle Maintenance", author: "Robert M. Pirsig", year: 1974, genre: "big-idea" },
  { title: "Lila", author: "Robert M. Pirsig", year: 1991, genre: "big-idea" },
  { title: "Man's Search for Meaning", author: "Viktor E. Frankl", year: 1946, genre: "big-idea" },
  { title: "Meditations", author: "Marcus Aurelius", year: 180, genre: "big-idea" },
  { title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn", year: 1962, genre: "big-idea" },
  { title: "The Denial of Death", author: "Ernest Becker", year: 1973, genre: "big-idea" },
  { title: "Thinking, Fast and Slow", author: "Daniel Kahneman", year: 2011, genre: "big-idea" },
  { title: "Sapiens", author: "Yuval Noah Harari", year: 2011, genre: "big-idea" },
  { title: "The Immortal Life of Henrietta Lacks", author: "Rebecca Skloot", year: 2010, genre: "non-fiction-essays" },
  { title: "The Emperor of All Maladies", author: "Siddhartha Mukherjee", year: 2010, genre: "non-fiction-essays" },
  { title: "The Warmth of Other Suns", author: "Isabel Wilkerson", year: 2010, genre: "history" },
  { title: "Team of Rivals", author: "Doris Kearns Goodwin", year: 2005, genre: "history" },
  { title: "The Guns of August", author: "Barbara W. Tuchman", year: 1962, genre: "history" },
  { title: "A People's History of the United States", author: "Howard Zinn", year: 1980, genre: "history" },
  { title: "The Making of the Atomic Bomb", author: "Richard Rhodes", year: 1986, genre: "history" },
  { title: "Ron Chernow's Grant", author: "Ron Chernow", year: 2017, genre: "memoir-biography" },
  { title: "Hamilton", author: "Ron Chernow", year: 2004, genre: "memoir-biography" },
  { title: "On Writing", author: "Stephen King", year: 2000, genre: "memoir-biography" },
  { title: "Bird by Bird", author: "Anne Lamott", year: 1994, genre: "non-fiction-essays" },
  { title: "The Elements of Style", author: "William Strunk Jr. & E.B. White", year: 1918, genre: "non-fiction-essays" },
  { title: "Draft No. 4", author: "John McPhee", year: 2017, genre: "non-fiction-essays" },
  { title: "Coming into the Country", author: "John McPhee", year: 1977, genre: "nature-writing" },
  { title: "Encounters with the Archdruid", author: "John McPhee", year: 1971, genre: "nature-writing" },
  { title: "Annals of the Former World", author: "John McPhee", year: 1998, genre: "nature-writing" },
  { title: "The New New Thing", author: "Michael Lewis", year: 1999, genre: "non-fiction-essays" },
  { title: "Moneyball", author: "Michael Lewis", year: 2003, genre: "non-fiction-essays" },
  { title: "The Big Short", author: "Michael Lewis", year: 2010, genre: "non-fiction-essays" },
  { title: "Liar's Poker", author: "Michael Lewis", year: 1989, genre: "non-fiction-essays" },
  { title: "The Undoing Project", author: "Michael Lewis", year: 2016, genre: "non-fiction-essays" },
  { title: "The Devil in the White City", author: "Erik Larson", year: 2003, genre: "history" },
  { title: "In the Garden of Beasts", author: "Erik Larson", year: 2011, genre: "history" },
  { title: "Devotions", author: "Mary Oliver", year: 2017, genre: "poetry" },
  { title: "New and Selected Poems, Volume One", author: "Mary Oliver", year: 1992, genre: "poetry" },
  { title: "Collected Poems", author: "Wendell Berry", year: 1985, genre: "poetry" },
  { title: "Ariel", author: "Sylvia Plath", year: 1965, genre: "poetry" },
  { title: "The Waste Land", author: "T. S. Eliot", year: 1922, genre: "poetry" },
  { title: "Four Quartets", author: "T. S. Eliot", year: 1943, genre: "poetry" },
  { title: "Leaves of Grass", author: "Walt Whitman", year: 1855, genre: "poetry" },
];

/** Compact, prompt-friendly listing of the shelf for the writer. */
export function shelfSummaryForPrompt(): string {
  const grouped: Record<string, ShelfBook[]> = {};
  for (const b of LATTE_BOOK_SHELF) {
    if (!grouped[b.genre]) grouped[b.genre] = [];
    grouped[b.genre]!.push(b);
  }
  const order: ShelfBook["genre"][] = [
    "literary-fiction",
    "classic-fiction",
    "non-fiction-essays",
    "memoir-biography",
    "nature-writing",
    "adventure-expedition",
    "history",
    "big-idea",
    "poetry",
  ];
  const lines: string[] = [];
  for (const genre of order) {
    const items = grouped[genre];
    if (!items || items.length === 0) continue;
    lines.push(`### ${genre.replace(/-/g, " ").toUpperCase()}`);
    for (const b of items) {
      lines.push(`- ${b.title} — ${b.author} (${b.year})`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
