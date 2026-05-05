import { BRANDS } from "@/lib/mock-inbox";
import { brandStats, recentSends } from "@/lib/mock-stats";
import Link from "next/link";

export const metadata = {
  title: "Stats — Email Sender Platform",
};

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function num(n: number): string {
  return n.toLocaleString();
}

function rate(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.0%";
  return pct((numerator / denominator) * 100);
}

export default function StatsPage() {
  const totalAudience = brandStats.reduce((acc, b) => acc + b.audienceSize, 0);
  const totalSends = brandStats.reduce((acc, b) => acc + b.sendsLast30, 0);
  const weightedOpens =
    brandStats.reduce((acc, b) => acc + b.openRate * b.audienceSize, 0) / totalAudience;

  return (
    <main className="preview-main">
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>Engagement stats</h1>
        <p className="tagline">
          Last 30 days · {num(totalAudience)} subscribers · {totalSends} sends · weighted open rate{" "}
          {pct(weightedOpens)}
        </p>
      </header>

      <section className="card">
        <h2>Per brand</h2>
        <table className="persona-table">
          <thead>
            <tr>
              <th>Brand</th>
              <th>Audience</th>
              <th>Sends</th>
              <th>Open</th>
              <th>Click</th>
              <th>Reply</th>
              <th>Unsub</th>
              <th>Bounce</th>
            </tr>
          </thead>
          <tbody>
            {brandStats.map((b) => (
              <tr key={b.brandId}>
                <td>
                  <span
                    className="brand-dot"
                    style={{ background: BRANDS[b.brandId]?.color, marginRight: 8 }}
                  />
                  {b.brandName}
                </td>
                <td className="num">{num(b.audienceSize)}</td>
                <td className="num">{b.sendsLast30}</td>
                <td className="num">{pct(b.openRate)}</td>
                <td className="num">{pct(b.clickRate)}</td>
                <td className="num">{pct(b.replyRate)}</td>
                <td className="num">{pct(b.unsubRate)}</td>
                <td className="num">{pct(b.bounceRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Recent sends</h2>
        <table className="persona-table">
          <thead>
            <tr>
              <th>Sent</th>
              <th>Brand</th>
              <th>Subject</th>
              <th>Recipients</th>
              <th>Open</th>
              <th>Click</th>
              <th>Reply</th>
            </tr>
          </thead>
          <tbody>
            {recentSends.map((s) => (
              <tr key={s.episodeId}>
                <td className="num" style={{ whiteSpace: "nowrap" }}>
                  {new Date(s.sentAt).toLocaleDateString()}
                </td>
                <td>{s.brandName}</td>
                <td style={{ fontSize: 12 }}>
                  <Link href={`/episodes/${s.episodeId}` as never}>{s.subjectLine}</Link>
                </td>
                <td className="num">{num(s.recipients)}</td>
                <td className="num">{rate(s.opens, s.recipients)}</td>
                <td className="num">{rate(s.clicks, s.recipients)}</td>
                <td className="num">{rate(s.replies, s.recipients)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer>
        <p>
          Real numbers come from <code>send_events</code> rolled up per spec 09. Section-level click
          attribution lands when the webhook handler writes <code>click_section</code> values from
          the rendered template's tracking params.
        </p>
      </footer>
    </main>
  );
}
