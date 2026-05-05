import { listPersonaSlugs, loadPersona } from "@/lib/persona-data";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return listPersonaSlugs().map((slug) => ({ slug }));
}

type Params = Promise<{ slug: string }>;

export default async function PersonaPage({ params }: { params: Params }) {
  const { slug } = await params;
  const persona = loadPersona(slug);
  if (!persona) notFound();

  // Render markdown headers and paragraphs as basic HTML.
  const blocks = persona.body.split(/\n{2,}/);

  return (
    <main className="preview-main">
      <header>
        <Link href="/voice/personas" className="back">
          ← personas
        </Link>
        <div className="row-meta">
          <code className="module-id">{persona.moduleId}</code>
          <span>v{persona.version}</span>
          <span>{persona.status}</span>
        </div>
        <h1>{persona.title}</h1>
        <p className="tagline">{persona.description}</p>
      </header>

      <section className="card persona-body">
        {blocks.map((block, i) => {
          const trimmed = block.trim();
          if (trimmed.startsWith("## ")) {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static markdown blocks
              <h2 key={i}>{trimmed.slice(3)}</h2>
            );
          }
          if (trimmed.startsWith("### ")) {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static markdown blocks
              <h3 key={i}>{trimmed.slice(4)}</h3>
            );
          }
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            const items = trimmed.split(/\n/).map((line) => line.replace(/^[-*]\s+/, ""));
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: static markdown blocks
              <ul key={i}>
                {items.map((item, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static markdown items
                  <li key={j}>{item}</li>
                ))}
              </ul>
            );
          }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static markdown blocks
            <p key={i}>{trimmed}</p>
          );
        })}
      </section>

      <footer>
        <p>
          Persona module loaded from <code>{persona.moduleId}.md</code>. Full markdown rendered
          above. Edits land via PR per <code>docs/specs/03_voice_system.spec.md</code>.
        </p>
      </footer>
    </main>
  );
}
