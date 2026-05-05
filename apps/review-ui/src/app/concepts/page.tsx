import { mockContentConcepts, mockFrameworkConcepts } from "@/lib/mock-concepts";
import Link from "next/link";

export const metadata = {
  title: "Brain — concepts — Email Sender Platform",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "permanent";
  return new Date(iso).toLocaleDateString();
}

function daysFromNow(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (d <= 0) return "available now";
  return `${d}d`;
}

export default function ConceptsPage() {
  const fw = mockFrameworkConcepts;
  const content = mockContentConcepts;

  const fwByFamily = fw.reduce(
    (acc, c) => {
      acc[c.frameworkFamily] = acc[c.frameworkFamily] ?? [];
      acc[c.frameworkFamily]?.push(c);
      return acc;
    },
    {} as Record<string, typeof fw>,
  );

  const contentBySection = content.reduce(
    (acc, c) => {
      acc[c.sectionName] = acc[c.sectionName] ?? [];
      acc[c.sectionName]?.push(c);
      return acc;
    },
    {} as Record<string, typeof content>,
  );

  return (
    <main className="preview-main">
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>Brain — concepts</h1>
        <p className="tagline">
          Two architectural layers: framework concepts (reusable) and content concepts (locked out
          per lookback). Per spec 05.
        </p>
      </header>

      <section className="card">
        <h2>
          Framework concepts <span className="flag-count">({fw.length})</span>
        </h2>
        <p className="module-description" style={{ marginBottom: 16 }}>
          Reusable structural patterns. High-performers are eligible for reuse within the variety
          envelope. Performance is computed from observed engagement when the framework is used.
        </p>

        {Object.entries(fwByFamily).map(([family, list]) => (
          <article key={family} className="section-block">
            <h3>{family.replace(/_/g, " ")}</h3>
            <table className="persona-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Score</th>
                  <th>Uses</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="persona-name">{c.frameworkName}</td>
                    <td style={{ fontSize: 12 }}>{c.description}</td>
                    <td className="num">{c.performanceScore?.toFixed(1) ?? "—"}</td>
                    <td className="num">{c.useCount}</td>
                    <td>
                      <span
                        className={
                          c.status === "active"
                            ? "pill pill-pass"
                            : c.status === "experimental"
                              ? "pill pill-experimental"
                              : "pill pill-deprecated"
                        }
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>

      <section className="card">
        <h2>
          Content concepts <span className="flag-count">({content.length})</span>
        </h2>
        <p className="module-description" style={{ marginBottom: 16 }}>
          Specific topics, destinations, and recommendations. Locked out within the lookback window
          regardless of performance. Hard-blocked items are permanently excluded.
        </p>

        {Object.entries(contentBySection).map(([section, list]) => (
          <article key={section} className="section-block">
            <h3>{section.replace(/_/g, " ")}</h3>
            <table className="persona-table">
              <thead>
                <tr>
                  <th>Surface form</th>
                  <th>Concept</th>
                  <th>Used</th>
                  <th>Available in</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td className="persona-name">{c.surfaceForm ?? "—"}</td>
                    <td style={{ fontSize: 12 }}>{c.conceptSummary}</td>
                    <td className="num">{fmtDate(c.usedAt)}</td>
                    <td className="num">{daysFromNow(c.lookbackUntil)}</td>
                    <td>
                      {c.hardBlocked ? (
                        <span className="pill pill-fail">hard blocked</span>
                      ) : (
                        <span className="pill pill-experimental">locked out</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>

      <footer>
        <p>
          Real concepts come from <code>framework_concepts</code> and <code>content_concepts</code>{" "}
          tables, queried during topic proposal and concept-check per spec 05. Embeddings via
          pgvector handle similarity matching.
        </p>
      </footer>
    </main>
  );
}
