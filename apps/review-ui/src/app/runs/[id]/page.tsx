import { getMockRun, listMockRunIds } from "@/lib/mock-runs";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return listMockRunIds().map((id) => ({ id }));
}

type Params = Promise<{ id: string }>;

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export default async function RunDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const run = getMockRun(id);
  if (!run) notFound();

  const totalLatency = run.blockExecutions.reduce((acc, b) => acc + b.latencyMs, 0);

  return (
    <main className="preview-main">
      <header>
        <Link href="/runs" className="back">
          ← runs
        </Link>
        <div className="row-meta">
          <span className="brand">{run.brandName}</span>
          <span className="edition">{run.edition}</span>
          <span className="content-type">{run.triggeredBy}</span>
        </div>
        <h1>{run.id}</h1>
        <p className="tagline">
          started {new Date(run.startedAt).toLocaleString()}
          {run.episodeId && (
            <>
              {" · "}
              <Link href={`/episodes/${run.episodeId}` as never}>view episode</Link>
            </>
          )}
        </p>
      </header>

      <section className="card">
        <h2>Summary</h2>
        <div className="quality-large">
          <div className="metric">
            <span className="metric-label">status</span>
            <span className={run.status === "completed" ? "pill pill-pass" : "pill pill-fail"}>
              {run.status}
            </span>
          </div>
          <div className="metric">
            <span className="metric-label">blocks</span>
            <span className="metric-value-lg">{run.blockExecutions.length}</span>
          </div>
          <div className="metric">
            <span className="metric-label">total cost</span>
            <span className="metric-value-lg">{fmtUsd(run.totalCostUsd)}</span>
          </div>
          <div className="metric">
            <span className="metric-label">tokens in</span>
            <span className="metric-value-lg">{fmtTokens(run.totalInputTokens)}</span>
          </div>
          <div className="metric">
            <span className="metric-label">tokens out</span>
            <span className="metric-value-lg">{fmtTokens(run.totalOutputTokens)}</span>
          </div>
          <div className="metric">
            <span className="metric-label">total latency</span>
            <span className="metric-value-lg">{fmtMs(totalLatency)}</span>
          </div>
        </div>
      </section>

      <section className="card preview-frame-card">
        <h2>Block executions</h2>
        <table className="persona-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Block</th>
              <th>Provider / Model</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {run.blockExecutions.map((b) => (
              <tr key={b.id}>
                <td className="num">{b.sequence}</td>
                <td className="persona-name">{b.blockName}</td>
                <td>
                  {b.provider ? (
                    <>
                      {b.provider} · <code>{b.model}</code>
                      {b.fallbackUsed && (
                        <span className="pill pill-experimental" style={{ marginLeft: 6 }}>
                          fallback
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>—</span>
                  )}
                </td>
                <td className="num">
                  {fmtTokens(b.inputTokens)} / {fmtTokens(b.outputTokens)}
                </td>
                <td className="num">{b.costUsd > 0 ? fmtUsd(b.costUsd) : "—"}</td>
                <td className="num">{fmtMs(b.latencyMs)}</td>
                <td>
                  <span
                    className={
                      b.validationStatus === "passed"
                        ? "pill pill-pass"
                        : b.validationStatus === "failed"
                          ? "pill pill-fail"
                          : "pill pill-experimental"
                    }
                  >
                    {b.validationStatus}
                    {b.retryCount > 0 ? ` · ${b.retryCount} retries` : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer>
        <p>
          Real run data comes from <code>pipeline_runs</code> and <code>block_executions</code> per
          spec 02. The query runs once Supabase is wired.
        </p>
      </footer>
    </main>
  );
}
