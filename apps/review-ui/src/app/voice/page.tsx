import { type VoiceModuleSummary, loadAllVoiceModules } from "@/lib/voice-modules-data";
import Link from "next/link";

export const metadata = {
  title: "Voice modules — Email Sender Platform",
};

function groupByCategory(mods: VoiceModuleSummary[]): Map<string, VoiceModuleSummary[]> {
  const out = new Map<string, VoiceModuleSummary[]>();
  for (const m of mods) {
    const key = m.id.split("/")[0] ?? "other";
    const list = out.get(key) ?? [];
    list.push(m);
    out.set(key, list);
  }
  return out;
}

export default function VoicePage() {
  const all = loadAllVoiceModules();
  const grouped = groupByCategory(all);
  const groupOrder = ["core", "brands", "personas"].filter((g) => grouped.has(g));
  for (const k of grouped.keys()) {
    if (!groupOrder.includes(k)) groupOrder.push(k);
  }

  return (
    <main>
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>Voice modules</h1>
        <p className="tagline">{all.length} modules · composed at runtime per block per brand</p>
        <nav className="brand-filter" style={{ marginTop: 16 }}>
          <Link href="/voice/composition" className="filter-pill">
            → composition viewer
          </Link>
          <Link href="/voice/personas" className="filter-pill">
            → persona profiles
          </Link>
        </nav>
      </header>

      {groupOrder.map((group) => {
        const list = grouped.get(group) ?? [];
        return (
          <section key={group} className="card">
            <h2>
              {group}{" "}
              <span className="flag-count">
                ({list.length} module{list.length === 1 ? "" : "s"})
              </span>
            </h2>
            <ul className="modules">
              {list.map((m) => (
                <li key={m.id} className="module-row">
                  <div className="module-header">
                    <code className="module-id">{m.id}</code>
                    <span className="module-meta">
                      v{m.version}
                      {m.status !== "active" && (
                        <span className={`pill pill-${m.status}`}>{m.status}</span>
                      )}
                    </span>
                  </div>
                  <p className="module-description">{m.description}</p>
                  {m.bodyExcerpt && <p className="module-excerpt">{m.bodyExcerpt}…</p>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <footer>
        <p>
          Module changes are PRs against the repo per{" "}
          <code>docs/specs/03_voice_system.spec.md</code>. The review UI is read-only for voice
          modules — direct editing in the UI lands later.
        </p>
      </footer>
    </main>
  );
}
