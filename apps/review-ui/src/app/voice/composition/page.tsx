import { allCompositions } from "@/lib/voice-composition";
import Link from "next/link";

export const metadata = {
  title: "Voice composition — Email Sender Platform",
};

export default function CompositionPage() {
  return (
    <main className="preview-main">
      <header>
        <Link href="/voice" className="back">
          ← voice modules
        </Link>
        <h1>Voice composition</h1>
        <p className="tagline">
          Which voice modules compose for each block per brand × edition. The system prompt is
          assembled by concatenating these modules in order at run time per spec 03.
        </p>
      </header>

      {allCompositions.map((brand) => (
        <section key={brand.brandId} className="card">
          <h2>
            {brand.brandName}{" "}
            <span className="flag-count">
              v{brand.version} · {brand.editions.length} editions
            </span>
          </h2>

          {brand.editions.map((ed) => (
            <article key={ed.edition} className="section-block">
              <h3>{ed.edition}</h3>
              <ul className="modules">
                {ed.blocks.map((b) => (
                  <li key={b.block} className="module-row">
                    <div className="module-header">
                      <code className="module-id">{b.block}</code>
                      <span className="module-meta">
                        {b.modules.length} module{b.modules.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ol className="composition-stack">
                      {b.modules.map((m, i) => (
                        <li key={`${b.block}-${m}-${i}`} className="composition-step">
                          <span className="composition-num">{i + 1}</span>
                          <code className="composition-id">{m}</code>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ))}

      <footer>
        <p>
          The composer (<code>composeVoice()</code> in <code>@platform/voice-modules</code>) loads
          each module from disk, concatenates bodies in this order separated by markdown dividers,
          logs the resolved module-version list for replay, and returns the assembled system prompt.
        </p>
      </footer>
    </main>
  );
}
