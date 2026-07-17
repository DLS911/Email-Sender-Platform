import Link from "next/link";
import { getRecentIssueMetrics, getSubscriberSummaries } from "@/lib/engagement-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Engagement — Email Sender Platform",
};

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function num(n: number): string {
  return n.toLocaleString();
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function EngagementPage() {
  const [issues, subs] = await Promise.all([
    getRecentIssueMetrics(30).catch((err) => {
      console.error("engagement.issues_load_failed", err);
      return [];
    }),
    getSubscriberSummaries().catch((err) => {
      console.error("engagement.subs_load_failed", err);
      return [];
    }),
  ]);

  const totals = issues.reduce(
    (acc, i) => ({
      sent: acc.sent + i.sent,
      delivered: acc.delivered + i.delivered,
      opens: acc.opens + i.uniqueOpens,
      clicks: acc.clicks + i.uniqueClicks,
      bounces: acc.bounces + i.bounced,
    }),
    { sent: 0, delivered: 0, opens: 0, clicks: 0, bounces: 0 },
  );

  return (
    <main className="preview-main">
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>Engagement</h1>
        <p className="tagline">
          Last 30 days · {issues.length} issues · {num(totals.delivered)} delivered ·{" "}
          {totals.delivered > 0 ? pct(totals.opens / totals.delivered) : "—"} open rate ·{" "}
          {totals.delivered > 0 ? pct(totals.clicks / totals.delivered) : "—"} click rate
        </p>
        {issues.length === 0 && (
          <p style={{ color: "#9a8b7a", marginTop: 16 }}>
            No event data yet. Events start populating once Resend delivers the first tagged send
            after this deploy.
          </p>
        )}
      </header>

      <section style={{ marginTop: 32 }}>
        <h2>By issue</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5ded4", textAlign: "left" }}>
              <th style={{ padding: "10px 8px" }}>Brand</th>
              <th style={{ padding: "10px 8px" }}>Issue date</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Sent</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Delivered</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Opens</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Open rate</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Clicks</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Click rate</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Bounced</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((i) => (
              <tr key={`${i.brand}::${i.issueDate}`} style={{ borderBottom: "1px solid #f2ede4" }}>
                <td style={{ padding: "10px 8px" }}>{i.brand === "saturday_latte" ? "Latte" : "Daily Grind"}</td>
                <td style={{ padding: "10px 8px" }}>{i.issueDate}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(i.sent)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(i.delivered)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(i.uniqueOpens)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{pct(i.openRate)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(i.uniqueClicks)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{pct(i.clickRate)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(i.bounced)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2>By subscriber</h2>
        <p style={{ color: "#9a8b7a", fontSize: 13, marginTop: 4 }}>
          Sorted by most-recent event. {subs.length} subscribers with any event history.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16, fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5ded4", textAlign: "left" }}>
              <th style={{ padding: "10px 8px" }}>Email</th>
              <th style={{ padding: "10px 8px" }}>Last event</th>
              <th style={{ padding: "10px 8px" }}>Last event at</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Delivered</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Opens</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Clicks</th>
              <th style={{ padding: "10px 8px", textAlign: "right" }}>Bounces</th>
            </tr>
          </thead>
          <tbody>
            {subs.slice(0, 500).map((s) => (
              <tr key={s.email} style={{ borderBottom: "1px solid #f2ede4" }}>
                <td style={{ padding: "10px 8px" }}>
                  <Link
                    href={`/engagement/subscriber?email=${encodeURIComponent(s.email)}`}
                    style={{ color: "#2d2926", textDecoration: "none" }}
                  >
                    {s.email}
                  </Link>
                </td>
                <td style={{ padding: "10px 8px" }}>{s.lastEventType ?? "—"}</td>
                <td style={{ padding: "10px 8px" }}>{formatDate(s.lastEventAt)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(s.totalDelivered)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(s.totalOpens)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(s.totalClicks)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>{num(s.totalBounces)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {subs.length > 500 && (
          <p style={{ color: "#9a8b7a", fontSize: 13, marginTop: 8 }}>
            Showing 500 of {subs.length}. Filtering + pagination pending.
          </p>
        )}
      </section>
    </main>
  );
}
