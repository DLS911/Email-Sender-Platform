import { getMockEpisode, listMockEpisodeIds } from "@/lib/mock-episodes";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return listMockEpisodeIds().map((id) => ({ id }));
}

type Params = Promise<{ id: string }>;

export default async function EpisodePage({ params }: { params: Params }) {
  const { id } = await params;
  const episode = getMockEpisode(id);
  if (!episode) notFound();

  const flagCounts = episode.flags.reduce(
    (acc, f) => {
      acc[f.severity] = (acc[f.severity] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <main>
      <header>
        <Link href="/inbox" className="back">
          ← inbox
        </Link>
        <div className="row-meta">
          <span className="brand">{episode.brandName}</span>
          <span className="edition">{episode.edition}</span>
          <span className="content-type">{episode.contentType}</span>
        </div>
        <h1>{episode.headline}</h1>
        <p className="tagline">
          ships {new Date(episode.scheduledSendAt).toLocaleString()} · voice config v
          {episode.voiceConfigVersion}
        </p>
      </header>

      <section className="card">
        <h2>Quality score</h2>
        <div className="quality-large">
          <div className="metric">
            <span className="metric-label">love</span>
            <span className="metric-value-lg">{episode.qualityScore.love}</span>
          </div>
          <div className="metric">
            <span className="metric-label">share</span>
            <span className="metric-value-lg">{episode.qualityScore.share}</span>
          </div>
          <div className="metric">
            <span className="metric-label">churn risk</span>
            <span className="metric-value-lg">{episode.qualityScore.churn}</span>
          </div>
          <div className="metric">
            <span className="metric-label">status</span>
            <span className={episode.qualityScore.passed ? "pill pill-pass" : "pill pill-fail"}>
              {episode.qualityScore.passed ? "passed" : "failed"}
            </span>
          </div>
        </div>
      </section>

      {episode.flags.length > 0 && (
        <section className="card">
          <h2>
            Flags <span className="flag-count">({episode.flags.length})</span>
          </h2>
          <ul className="flags">
            {episode.flags.map((f, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: flags are static for this mock
                key={i}
                className={`flag flag-${f.severity}`}
              >
                <span className="flag-severity">{f.severity}</span>
                {f.section && <span className="flag-section">{f.section}</span>}
                <span className="flag-message">{f.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Persona panel</h2>
        <table className="persona-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Segment</th>
              <th>Love</th>
              <th>Share</th>
              <th>Unsub</th>
            </tr>
          </thead>
          <tbody>
            {episode.personaScores.map((p) => (
              <tr key={p.persona}>
                <td className="persona-name">{p.persona}</td>
                <td>
                  <span className={`segment segment-${p.segment.replace(/_/g, "-")}`}>
                    {p.segment.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="num">{p.love}</td>
                <td className="num">{p.share}</td>
                <td className="num">{p.unsub}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Headline options</h2>
        <ol className="headlines">
          <li className="selected">{episode.headline}</li>
          {episode.alternateHeadlines.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Sections</h2>
        {episode.sections.map((s) => (
          <article key={s.name} className="section-block">
            <h3>{s.name}</h3>
            {s.body.split("\n\n").map((para, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: mock content
              <p key={i}>{para}</p>
            ))}
          </article>
        ))}
      </section>

      <section className="card actions">
        <button type="button" className="btn btn-primary" disabled>
          Approve & schedule
        </button>
        <button type="button" className="btn" disabled>
          Save & re-review
        </button>
        <button type="button" className="btn btn-danger" disabled>
          Reject & regenerate
        </button>
        <p className="actions-note">
          Actions disabled in mock mode — wired to Supabase in stage 3.
        </p>
      </section>

      <footer>
        <p>
          Mock data. {Object.keys(flagCounts).length > 0 ? "Flag types in this episode: " : ""}
          {Object.entries(flagCounts).map(([k, v], i) => (
            <span key={k}>
              {i > 0 ? ", " : ""}
              {k} ({v})
            </span>
          ))}
        </p>
      </footer>
    </main>
  );
}
