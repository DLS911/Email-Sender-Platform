import { loadAllPersonas } from "@/lib/persona-data";
import Link from "next/link";

export const metadata = {
  title: "Personas — Email Sender Platform",
};

export default function PersonasPage() {
  const personas = loadAllPersonas();
  return (
    <main>
      <header>
        <Link href="/voice" className="back">
          ← voice modules
        </Link>
        <h1>Personas</h1>
        <p className="tagline">
          {personas.length} personas · the panel that scores every draft per spec 04
        </p>
      </header>

      <ul className="modules">
        {personas.map((p) => (
          <li key={p.slug} className="module-row">
            <Link href={`/voice/personas/${p.slug}` as never} className="inbox-link">
              <div className="module-header">
                <code className="module-id">{p.title}</code>
                <span className="module-meta">v{p.version}</span>
              </div>
              <p className="module-description">{p.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
