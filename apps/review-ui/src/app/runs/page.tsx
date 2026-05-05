import { mockRuns } from "@/lib/mock-runs";
import Link from "next/link";

export const metadata = {
  title: "Pipeline runs — Email Sender Platform",
};

export default function RunsPage() {
  const runs = Object.values(mockRuns).sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));

  return (
    <main>
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>Pipeline runs</h1>
        <p className="tagline">{runs.length} runs · last 7 days</p>
      </header>

      <ul className="inbox">
        {runs.map((run) => {
          const blocks = run.blockExecutions.length;
          const failures = run.blockExecutions.filter(
            (b) => b.status === "failed" || b.fallbackUsed,
          ).length;
          return (
            <li key={run.id} className="inbox-row">
              <Link href={`/runs/${run.id}` as never} className="inbox-link">
                <div className="row-meta">
                  <span className="brand">{run.brandName}</span>
                  <span className="edition">{run.edition}</span>
                  <span className="content-type">{run.triggeredBy}</span>
                </div>
                <h2 className="row-headline">
                  {run.id} · {blocks} blocks · ${run.totalCostUsd.toFixed(3)}
                  {failures > 0 ? ` · ${failures} fallback/retry` : ""}
                </h2>
                <div className="row-footer">
                  <span className="scheduled">
                    started {new Date(run.startedAt).toLocaleString()}
                  </span>
                  <span
                    className={run.status === "completed" ? "pill pill-pass" : "pill pill-fail"}
                  >
                    {run.status}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <footer>
        <p>
          Real runs come from <code>pipeline_runs</code> + <code>block_executions</code> tables per
          spec 10_observability when the worker is live.
        </p>
      </footer>
    </main>
  );
}
