/**
 * Curated Saturday Morning Latte book shelf — classics only.
 *
 * Rule: pre-1980 heavy, no modern press-release novels. Austin's take
 * is that modern bestseller charts are gamed and the reader is better
 * served by books that have already survived decades of readers making
 * up their own minds. So we lean on the canon.
 *
 * Windows:
 *   - Ancient / classical (Aurelius, Homer, Plato, Confucius, etc.)
 *   - Medieval / Renaissance (Dante, Cervantes, Montaigne, Shakespeare
 *     as a comparative reader)
 *   - 18th-19th century novel (Austen, Brontës, Dickens, Melville,
 *     Tolstoy, Dostoevsky, Twain, Eliot)
 *   - Modernist (Woolf, Joyce, Faulkner, Hemingway, Fitzgerald, Wharton)
 *   - Post-war through ~1980 (Steinbeck, McCarthy earliest, Morrison
 *     earliest, Ellison, Baldwin, Márquez, Bulgakov, Bellow, Percy,
 *     Pynchon, Kesey, Vonnegut, Heller)
 *   - Enduring 20th-century non-fiction (Silent Spring, Sand County,
 *     Meditations, Man's Search, Structure of Scientific Revolutions,
 *     Desert Solitaire, Pilgrim at Tinker Creek, Snow Leopard,
 *     Wind Sand and Stars, Elements of Style, McPhee, Didion, Baldwin
 *     essays, Wolfe)
 *
 * A very small handful of post-1980 works are included ONLY where they
 * are already treated as canonical alongside older books (Blood
 * Meridian, The Road, Beloved, Gilead) — these are the exceptions,
 * not the rule.
 *
 * Anything from the last ~25 years is deliberately excluded. If the
 * destination or research turns up a compelling region-specific
 * off-shelf pick, that's fine — the shelf is the default, not a
 * cage.
 */

export type ShelfBook = {
  title: string;
  author: string;
  year: number;
  genre:
    | "ancient-classical"
    | "classic-fiction"
    | "modernist-fiction"
    | "postwar-fiction"
    | "non-fiction-essays"
    | "nature-writing"
    | "memoir-biography"
    | "big-idea"
    | "adventure-expedition"
    | "history"
    | "poetry";
};

export const LATTE_BOOK_SHELF: ShelfBook[] = [
  // Ancient / classical
  { title: "Meditations", author: "Marcus Aurelius", year: 180, genre: "ancient-classical" },
  { title: "The Iliad", author: "Homer", year: -750, genre: "ancient-classical" },
  { title: "The Odyssey", author: "Homer", year: -750, genre: "ancient-classical" },
  { title: "The Republic", author: "Plato", year: -375, genre: "ancient-classical" },
  { title: "Nicomachean Ethics", author: "Aristotle", year: -340, genre: "ancient-classical" },
  { title: "Analects", author: "Confucius", year: -500, genre: "ancient-classical" },
  { title: "Tao Te Ching", author: "Lao Tzu", year: -400, genre: "ancient-classical" },
  { title: "Letters from a Stoic", author: "Seneca", year: 65, genre: "ancient-classical" },
  { title: "The Enchiridion", author: "Epictetus", year: 125, genre: "ancient-classical" },
  { title: "Confessions", author: "Augustine of Hippo", year: 400, genre: "ancient-classical" },

  // Medieval / Renaissance / Early modern
  { title: "The Divine Comedy", author: "Dante Alighieri", year: 1320, genre: "classic-fiction" },
  { title: "Don Quixote", author: "Miguel de Cervantes", year: 1605, genre: "classic-fiction" },
  { title: "Essays", author: "Michel de Montaigne", year: 1580, genre: "non-fiction-essays" },
  { title: "Pensées", author: "Blaise Pascal", year: 1670, genre: "non-fiction-essays" },
  { title: "The Prince", author: "Niccolò Machiavelli", year: 1532, genre: "big-idea" },

  // 18th – 19th century novel
  { title: "Pride and Prejudice", author: "Jane Austen", year: 1813, genre: "classic-fiction" },
  { title: "Emma", author: "Jane Austen", year: 1815, genre: "classic-fiction" },
  { title: "Persuasion", author: "Jane Austen", year: 1817, genre: "classic-fiction" },
  { title: "Sense and Sensibility", author: "Jane Austen", year: 1811, genre: "classic-fiction" },
  { title: "Mansfield Park", author: "Jane Austen", year: 1814, genre: "classic-fiction" },
  { title: "Jane Eyre", author: "Charlotte Brontë", year: 1847, genre: "classic-fiction" },
  { title: "Wuthering Heights", author: "Emily Brontë", year: 1847, genre: "classic-fiction" },
  { title: "Middlemarch", author: "George Eliot", year: 1871, genre: "classic-fiction" },
  { title: "Silas Marner", author: "George Eliot", year: 1861, genre: "classic-fiction" },
  { title: "Great Expectations", author: "Charles Dickens", year: 1861, genre: "classic-fiction" },
  { title: "David Copperfield", author: "Charles Dickens", year: 1850, genre: "classic-fiction" },
  { title: "Bleak House", author: "Charles Dickens", year: 1853, genre: "classic-fiction" },
  { title: "A Tale of Two Cities", author: "Charles Dickens", year: 1859, genre: "classic-fiction" },
  { title: "The Adventures of Huckleberry Finn", author: "Mark Twain", year: 1884, genre: "classic-fiction" },
  { title: "The Adventures of Tom Sawyer", author: "Mark Twain", year: 1876, genre: "classic-fiction" },
  { title: "Life on the Mississippi", author: "Mark Twain", year: 1883, genre: "memoir-biography" },
  { title: "Moby-Dick", author: "Herman Melville", year: 1851, genre: "classic-fiction" },
  { title: "Billy Budd, Sailor", author: "Herman Melville", year: 1891, genre: "classic-fiction" },
  { title: "War and Peace", author: "Leo Tolstoy", year: 1869, genre: "classic-fiction" },
  { title: "Anna Karenina", author: "Leo Tolstoy", year: 1877, genre: "classic-fiction" },
  { title: "The Death of Ivan Ilyich", author: "Leo Tolstoy", year: 1886, genre: "classic-fiction" },
  { title: "Crime and Punishment", author: "Fyodor Dostoevsky", year: 1866, genre: "classic-fiction" },
  { title: "The Brothers Karamazov", author: "Fyodor Dostoevsky", year: 1880, genre: "classic-fiction" },
  { title: "The Idiot", author: "Fyodor Dostoevsky", year: 1869, genre: "classic-fiction" },
  { title: "Notes from Underground", author: "Fyodor Dostoevsky", year: 1864, genre: "classic-fiction" },
  { title: "Fathers and Sons", author: "Ivan Turgenev", year: 1862, genre: "classic-fiction" },
  { title: "Dead Souls", author: "Nikolai Gogol", year: 1842, genre: "classic-fiction" },
  { title: "Madame Bovary", author: "Gustave Flaubert", year: 1857, genre: "classic-fiction" },
  { title: "Les Misérables", author: "Victor Hugo", year: 1862, genre: "classic-fiction" },
  { title: "The Count of Monte Cristo", author: "Alexandre Dumas", year: 1844, genre: "classic-fiction" },
  { title: "The Portrait of a Lady", author: "Henry James", year: 1881, genre: "classic-fiction" },
  { title: "The Turn of the Screw", author: "Henry James", year: 1898, genre: "classic-fiction" },
  { title: "Heart of Darkness", author: "Joseph Conrad", year: 1899, genre: "classic-fiction" },
  { title: "Lord Jim", author: "Joseph Conrad", year: 1900, genre: "classic-fiction" },
  { title: "The Return of the Native", author: "Thomas Hardy", year: 1878, genre: "classic-fiction" },
  { title: "Tess of the d'Urbervilles", author: "Thomas Hardy", year: 1891, genre: "classic-fiction" },
  { title: "Jude the Obscure", author: "Thomas Hardy", year: 1895, genre: "classic-fiction" },
  { title: "The Picture of Dorian Gray", author: "Oscar Wilde", year: 1890, genre: "classic-fiction" },

  // Modernist (early 20th century)
  { title: "The Age of Innocence", author: "Edith Wharton", year: 1920, genre: "modernist-fiction" },
  { title: "The House of Mirth", author: "Edith Wharton", year: 1905, genre: "modernist-fiction" },
  { title: "Ethan Frome", author: "Edith Wharton", year: 1911, genre: "modernist-fiction" },
  { title: "A Room With a View", author: "E. M. Forster", year: 1908, genre: "modernist-fiction" },
  { title: "Howards End", author: "E. M. Forster", year: 1910, genre: "modernist-fiction" },
  { title: "A Passage to India", author: "E. M. Forster", year: 1924, genre: "modernist-fiction" },
  { title: "The Magic Mountain", author: "Thomas Mann", year: 1924, genre: "modernist-fiction" },
  { title: "Death in Venice", author: "Thomas Mann", year: 1912, genre: "modernist-fiction" },
  { title: "Buddenbrooks", author: "Thomas Mann", year: 1901, genre: "modernist-fiction" },
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", year: 1925, genre: "modernist-fiction" },
  { title: "Tender Is the Night", author: "F. Scott Fitzgerald", year: 1934, genre: "modernist-fiction" },
  { title: "This Side of Paradise", author: "F. Scott Fitzgerald", year: 1920, genre: "modernist-fiction" },
  { title: "The Sun Also Rises", author: "Ernest Hemingway", year: 1926, genre: "modernist-fiction" },
  { title: "A Farewell to Arms", author: "Ernest Hemingway", year: 1929, genre: "modernist-fiction" },
  { title: "For Whom the Bell Tolls", author: "Ernest Hemingway", year: 1940, genre: "modernist-fiction" },
  { title: "The Old Man and the Sea", author: "Ernest Hemingway", year: 1952, genre: "modernist-fiction" },
  { title: "A Moveable Feast", author: "Ernest Hemingway", year: 1964, genre: "memoir-biography" },
  { title: "The Sound and the Fury", author: "William Faulkner", year: 1929, genre: "modernist-fiction" },
  { title: "As I Lay Dying", author: "William Faulkner", year: 1930, genre: "modernist-fiction" },
  { title: "Light in August", author: "William Faulkner", year: 1932, genre: "modernist-fiction" },
  { title: "Absalom, Absalom!", author: "William Faulkner", year: 1936, genre: "modernist-fiction" },
  { title: "To the Lighthouse", author: "Virginia Woolf", year: 1927, genre: "modernist-fiction" },
  { title: "Mrs Dalloway", author: "Virginia Woolf", year: 1925, genre: "modernist-fiction" },
  { title: "Orlando", author: "Virginia Woolf", year: 1928, genre: "modernist-fiction" },
  { title: "A Room of One's Own", author: "Virginia Woolf", year: 1929, genre: "non-fiction-essays" },
  { title: "Ulysses", author: "James Joyce", year: 1922, genre: "modernist-fiction" },
  { title: "Dubliners", author: "James Joyce", year: 1914, genre: "modernist-fiction" },
  { title: "A Portrait of the Artist as a Young Man", author: "James Joyce", year: 1916, genre: "modernist-fiction" },
  { title: "The Trial", author: "Franz Kafka", year: 1925, genre: "modernist-fiction" },
  { title: "The Metamorphosis", author: "Franz Kafka", year: 1915, genre: "modernist-fiction" },
  { title: "The Castle", author: "Franz Kafka", year: 1926, genre: "modernist-fiction" },
  { title: "Brave New World", author: "Aldous Huxley", year: 1932, genre: "modernist-fiction" },
  { title: "1984", author: "George Orwell", year: 1949, genre: "modernist-fiction" },
  { title: "Animal Farm", author: "George Orwell", year: 1945, genre: "modernist-fiction" },
  { title: "Down and Out in Paris and London", author: "George Orwell", year: 1933, genre: "memoir-biography" },
  { title: "Homage to Catalonia", author: "George Orwell", year: 1938, genre: "memoir-biography" },
  { title: "Politics and the English Language", author: "George Orwell", year: 1946, genre: "non-fiction-essays" },
  { title: "All the King's Men", author: "Robert Penn Warren", year: 1946, genre: "modernist-fiction" },

  // Post-war through ~1980
  { title: "East of Eden", author: "John Steinbeck", year: 1952, genre: "postwar-fiction" },
  { title: "The Grapes of Wrath", author: "John Steinbeck", year: 1939, genre: "modernist-fiction" },
  { title: "Of Mice and Men", author: "John Steinbeck", year: 1937, genre: "modernist-fiction" },
  { title: "Cannery Row", author: "John Steinbeck", year: 1945, genre: "postwar-fiction" },
  { title: "Travels with Charley", author: "John Steinbeck", year: 1962, genre: "memoir-biography" },
  { title: "Their Eyes Were Watching God", author: "Zora Neale Hurston", year: 1937, genre: "modernist-fiction" },
  { title: "Invisible Man", author: "Ralph Ellison", year: 1952, genre: "postwar-fiction" },
  { title: "Native Son", author: "Richard Wright", year: 1940, genre: "postwar-fiction" },
  { title: "Go Tell It on the Mountain", author: "James Baldwin", year: 1953, genre: "postwar-fiction" },
  { title: "Giovanni's Room", author: "James Baldwin", year: 1956, genre: "postwar-fiction" },
  { title: "Notes of a Native Son", author: "James Baldwin", year: 1955, genre: "non-fiction-essays" },
  { title: "The Fire Next Time", author: "James Baldwin", year: 1963, genre: "non-fiction-essays" },
  { title: "Catch-22", author: "Joseph Heller", year: 1961, genre: "postwar-fiction" },
  { title: "Slaughterhouse-Five", author: "Kurt Vonnegut", year: 1969, genre: "postwar-fiction" },
  { title: "Cat's Cradle", author: "Kurt Vonnegut", year: 1963, genre: "postwar-fiction" },
  { title: "Mother Night", author: "Kurt Vonnegut", year: 1961, genre: "postwar-fiction" },
  { title: "One Hundred Years of Solitude", author: "Gabriel García Márquez", year: 1967, genre: "postwar-fiction" },
  { title: "The Master and Margarita", author: "Mikhail Bulgakov", year: 1967, genre: "postwar-fiction" },
  { title: "One Day in the Life of Ivan Denisovich", author: "Aleksandr Solzhenitsyn", year: 1962, genre: "postwar-fiction" },
  { title: "The Gulag Archipelago", author: "Aleksandr Solzhenitsyn", year: 1973, genre: "memoir-biography" },
  { title: "The Stranger", author: "Albert Camus", year: 1942, genre: "postwar-fiction" },
  { title: "The Plague", author: "Albert Camus", year: 1947, genre: "postwar-fiction" },
  { title: "The Myth of Sisyphus", author: "Albert Camus", year: 1942, genre: "big-idea" },
  { title: "Nausea", author: "Jean-Paul Sartre", year: 1938, genre: "modernist-fiction" },
  { title: "The Old Man and the Sea", author: "Ernest Hemingway", year: 1952, genre: "postwar-fiction" },
  { title: "On the Road", author: "Jack Kerouac", year: 1957, genre: "postwar-fiction" },
  { title: "The Dharma Bums", author: "Jack Kerouac", year: 1958, genre: "postwar-fiction" },
  { title: "Franny and Zooey", author: "J. D. Salinger", year: 1961, genre: "postwar-fiction" },
  { title: "The Catcher in the Rye", author: "J. D. Salinger", year: 1951, genre: "postwar-fiction" },
  { title: "One Flew Over the Cuckoo's Nest", author: "Ken Kesey", year: 1962, genre: "postwar-fiction" },
  { title: "Gravity's Rainbow", author: "Thomas Pynchon", year: 1973, genre: "postwar-fiction" },
  { title: "The Crying of Lot 49", author: "Thomas Pynchon", year: 1966, genre: "postwar-fiction" },
  { title: "The Adventures of Augie March", author: "Saul Bellow", year: 1953, genre: "postwar-fiction" },
  { title: "Herzog", author: "Saul Bellow", year: 1964, genre: "postwar-fiction" },
  { title: "Humboldt's Gift", author: "Saul Bellow", year: 1975, genre: "postwar-fiction" },
  { title: "The Moviegoer", author: "Walker Percy", year: 1961, genre: "postwar-fiction" },
  { title: "A Confederacy of Dunces", author: "John Kennedy Toole", year: 1980, genre: "postwar-fiction" },
  { title: "The Bell Jar", author: "Sylvia Plath", year: 1963, genre: "postwar-fiction" },
  { title: "Stoner", author: "John Williams", year: 1965, genre: "postwar-fiction" },
  { title: "Augustus", author: "John Williams", year: 1972, genre: "postwar-fiction" },

  // Late-20th century that has already earned canonical treatment
  { title: "Blood Meridian", author: "Cormac McCarthy", year: 1985, genre: "postwar-fiction" },
  { title: "Suttree", author: "Cormac McCarthy", year: 1979, genre: "postwar-fiction" },
  { title: "All the Pretty Horses", author: "Cormac McCarthy", year: 1992, genre: "postwar-fiction" },
  { title: "The Road", author: "Cormac McCarthy", year: 2006, genre: "postwar-fiction" },
  { title: "Beloved", author: "Toni Morrison", year: 1987, genre: "postwar-fiction" },
  { title: "Song of Solomon", author: "Toni Morrison", year: 1977, genre: "postwar-fiction" },
  { title: "Sula", author: "Toni Morrison", year: 1973, genre: "postwar-fiction" },
  { title: "Housekeeping", author: "Marilynne Robinson", year: 1980, genre: "postwar-fiction" },
  { title: "Gilead", author: "Marilynne Robinson", year: 2004, genre: "postwar-fiction" },

  // Enduring 20th-century non-fiction
  { title: "A Sand County Almanac", author: "Aldo Leopold", year: 1949, genre: "nature-writing" },
  { title: "Silent Spring", author: "Rachel Carson", year: 1962, genre: "nature-writing" },
  { title: "Desert Solitaire", author: "Edward Abbey", year: 1968, genre: "nature-writing" },
  { title: "The Monkey Wrench Gang", author: "Edward Abbey", year: 1975, genre: "postwar-fiction" },
  { title: "Pilgrim at Tinker Creek", author: "Annie Dillard", year: 1974, genre: "nature-writing" },
  { title: "The Snow Leopard", author: "Peter Matthiessen", year: 1978, genre: "nature-writing" },
  { title: "The Peregrine", author: "J. A. Baker", year: 1967, genre: "nature-writing" },
  { title: "In Patagonia", author: "Bruce Chatwin", year: 1977, genre: "nature-writing" },
  { title: "Arctic Dreams", author: "Barry Lopez", year: 1986, genre: "nature-writing" },
  { title: "Of Wolves and Men", author: "Barry Lopez", year: 1978, genre: "nature-writing" },
  { title: "The Unsettling of America", author: "Wendell Berry", year: 1977, genre: "nature-writing" },
  { title: "Wind, Sand and Stars", author: "Antoine de Saint-Exupéry", year: 1939, genre: "adventure-expedition" },
  { title: "Night Flight", author: "Antoine de Saint-Exupéry", year: 1931, genre: "adventure-expedition" },
  { title: "Endurance: Shackleton's Incredible Voyage", author: "Alfred Lansing", year: 1959, genre: "adventure-expedition" },
  { title: "West with the Night", author: "Beryl Markham", year: 1942, genre: "memoir-biography" },
  { title: "Out of Africa", author: "Isak Dinesen", year: 1937, genre: "memoir-biography" },
  { title: "Slouching Towards Bethlehem", author: "Joan Didion", year: 1968, genre: "non-fiction-essays" },
  { title: "The White Album", author: "Joan Didion", year: 1979, genre: "non-fiction-essays" },
  { title: "In Cold Blood", author: "Truman Capote", year: 1966, genre: "non-fiction-essays" },
  { title: "The Right Stuff", author: "Tom Wolfe", year: 1979, genre: "memoir-biography" },
  { title: "The Electric Kool-Aid Acid Test", author: "Tom Wolfe", year: 1968, genre: "non-fiction-essays" },
  { title: "The Kingdom and the Power", author: "Gay Talese", year: 1969, genre: "non-fiction-essays" },
  { title: "Fear and Loathing in Las Vegas", author: "Hunter S. Thompson", year: 1971, genre: "non-fiction-essays" },
  { title: "Encounters with the Archdruid", author: "John McPhee", year: 1971, genre: "nature-writing" },
  { title: "Coming into the Country", author: "John McPhee", year: 1977, genre: "nature-writing" },
  { title: "Oranges", author: "John McPhee", year: 1967, genre: "non-fiction-essays" },
  { title: "Levels of the Game", author: "John McPhee", year: 1969, genre: "non-fiction-essays" },

  // Enduring big-idea / philosophy / working craft
  { title: "Zen and the Art of Motorcycle Maintenance", author: "Robert M. Pirsig", year: 1974, genre: "big-idea" },
  { title: "Man's Search for Meaning", author: "Viktor E. Frankl", year: 1946, genre: "big-idea" },
  { title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn", year: 1962, genre: "big-idea" },
  { title: "The Denial of Death", author: "Ernest Becker", year: 1973, genre: "big-idea" },
  { title: "The Elements of Style", author: "William Strunk Jr. & E.B. White", year: 1918, genre: "non-fiction-essays" },
  { title: "On Writing Well", author: "William Zinsser", year: 1976, genre: "non-fiction-essays" },
  { title: "Walden", author: "Henry David Thoreau", year: 1854, genre: "nature-writing" },
  { title: "Nature", author: "Ralph Waldo Emerson", year: 1836, genre: "non-fiction-essays" },
  { title: "Self-Reliance", author: "Ralph Waldo Emerson", year: 1841, genre: "non-fiction-essays" },
  { title: "The Souls of Black Folk", author: "W. E. B. Du Bois", year: 1903, genre: "non-fiction-essays" },
  { title: "Narrative of the Life of Frederick Douglass", author: "Frederick Douglass", year: 1845, genre: "memoir-biography" },
  { title: "The Education of Henry Adams", author: "Henry Adams", year: 1918, genre: "memoir-biography" },
  { title: "Speak, Memory", author: "Vladimir Nabokov", year: 1951, genre: "memoir-biography" },

  // History that has held up
  { title: "The Guns of August", author: "Barbara W. Tuchman", year: 1962, genre: "history" },
  { title: "A Distant Mirror", author: "Barbara W. Tuchman", year: 1978, genre: "history" },
  { title: "The Rise and Fall of the Third Reich", author: "William L. Shirer", year: 1960, genre: "history" },
  { title: "The Making of the President 1960", author: "Theodore H. White", year: 1961, genre: "history" },
  { title: "The Power Broker", author: "Robert A. Caro", year: 1974, genre: "history" },
  { title: "The Making of the Atomic Bomb", author: "Richard Rhodes", year: 1986, genre: "history" },

  // Poetry (all canonical)
  { title: "Leaves of Grass", author: "Walt Whitman", year: 1855, genre: "poetry" },
  { title: "The Waste Land", author: "T. S. Eliot", year: 1922, genre: "poetry" },
  { title: "Four Quartets", author: "T. S. Eliot", year: 1943, genre: "poetry" },
  { title: "North of Boston", author: "Robert Frost", year: 1914, genre: "poetry" },
  { title: "Selected Poems", author: "Emily Dickinson", year: 1890, genre: "poetry" },
  { title: "Collected Poems", author: "Wallace Stevens", year: 1954, genre: "poetry" },
  { title: "Ariel", author: "Sylvia Plath", year: 1965, genre: "poetry" },
  { title: "Howl and Other Poems", author: "Allen Ginsberg", year: 1956, genre: "poetry" },
];

/** Compact, prompt-friendly listing of the shelf for the writer. */
export function shelfSummaryForPrompt(): string {
  const grouped: Record<string, ShelfBook[]> = {};
  for (const b of LATTE_BOOK_SHELF) {
    if (!grouped[b.genre]) grouped[b.genre] = [];
    grouped[b.genre]!.push(b);
  }
  const order: ShelfBook["genre"][] = [
    "ancient-classical",
    "classic-fiction",
    "modernist-fiction",
    "postwar-fiction",
    "non-fiction-essays",
    "nature-writing",
    "memoir-biography",
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
