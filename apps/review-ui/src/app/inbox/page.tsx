import { mockInbox } from "@/lib/mock-inbox";
import Link from "next/link";

export const metadata = {
  title: "Inbox — Email Sender Platform",
};

function StatusPill({ passed }: { passed: boolean }) {
  return (
    <span className={passed ? "pill pill-pass" : "pill pill-fail"}>
      {passed ? "passed" : "failed"}
    </span>
  );
}

function QualityScore({ love, share, churn }: { love: number; share: number; churn: number }) {
  return (
    <div className="quality">
      <span className="metric">
        <span className="metric-label">love</span>
        <span className="metric-value">{love}</span>
      </span>
      <span className="metric">
        <span className="metric-label">share</span>
        <span className="metric-value">{share}</span>
      </span>
      <span className="metric">
        <span className="metric-label">churn</span>
        <span className="metric-value">{churn}</span>
      </span>
    </div>
  );
}

export default function InboxPage() {
  return (
    <main>
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>Pending review</h1>
        <p className="tagline">{mockInbox.length} drafts awaiting approval</p>
      </header>

      <ul className="inbox">
        {mockInbox.map((row) => (
          <li key={row.id} className="inbox-row">
            <Link href={`/episodes/${row.id}` as never} className="inbox-link">
              <div className="row-meta">
                <span className="brand">{row.brandName}</span>
                <span className="edition">{row.edition}</span>
                <span className="content-type">{row.contentType}</span>
              </div>
              <h2 className="row-headline">{row.headline}</h2>
              <div className="row-footer">
                <span className="scheduled">
                  ships {new Date(row.scheduledSendAt).toLocaleString()}
                </span>
                <QualityScore
                  love={row.qualityScore.love}
                  share={row.qualityScore.share}
                  churn={row.qualityScore.churn}
                />
                <StatusPill passed={row.qualityScore.passed} />
              </div>
            </Link>
          </li>
        ))}
      </ul>

      <footer>
        <p>
          Mock data. Real inbox lands per <code>docs/specs/08_review_interface.spec.md</code> once
          Supabase is wired.
        </p>
      </footer>
    </main>
  );
}
