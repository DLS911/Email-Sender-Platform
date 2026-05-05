import { BRANDS, type BrandId, mockInbox } from "@/lib/mock-inbox";
import Link from "next/link";

export const metadata = {
  title: "Inbox — Email Sender Platform",
};

type SearchParams = Promise<{ brand?: string }>;

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

function isBrandId(value: string): value is BrandId {
  return value in BRANDS;
}

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filterBrand = params.brand && isBrandId(params.brand) ? params.brand : null;
  const visible = filterBrand ? mockInbox.filter((r) => r.brandId === filterBrand) : mockInbox;

  const counts: Record<BrandId, number> = {
    castor_abbott: 0,
    cortex: 0,
    fidelon: 0,
    treasure_financial: 0,
  };
  for (const r of mockInbox) counts[r.brandId]++;

  return (
    <main>
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>Pending review</h1>
        <p className="tagline">
          {visible.length} of {mockInbox.length} drafts shown
        </p>
      </header>

      <nav className="brand-filter">
        <Link href="/inbox" className={!filterBrand ? "filter-pill filter-active" : "filter-pill"}>
          all <span className="filter-count">{mockInbox.length}</span>
        </Link>
        {(Object.keys(BRANDS) as BrandId[]).map((bid) => (
          <Link
            key={bid}
            href={`/inbox?brand=${bid}` as never}
            className={filterBrand === bid ? "filter-pill filter-active" : "filter-pill"}
            style={{ borderColor: filterBrand === bid ? BRANDS[bid].color : undefined }}
          >
            <span className="brand-dot" style={{ background: BRANDS[bid].color }} />
            {BRANDS[bid].name}
            <span className="filter-count">{counts[bid]}</span>
          </Link>
        ))}
      </nav>

      <ul className="inbox">
        {visible.map((row) => (
          <li key={row.id} className="inbox-row">
            <Link href={`/episodes/${row.id}` as never} className="inbox-link">
              <div className="row-meta">
                <span className="brand" style={{ color: BRANDS[row.brandId]?.color ?? undefined }}>
                  {row.brandName}
                </span>
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

      {visible.length === 0 && (
        <section className="card">
          <p>No drafts for this brand.</p>
        </section>
      )}

      <footer>
        <p>
          Mock data. Real inbox lands per <code>docs/specs/08_review_interface.spec.md</code> once
          Supabase is wired.
        </p>
      </footer>
    </main>
  );
}
