import Link from "next/link";
import { getSubscriberEvents } from "@/lib/engagement-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Subscriber engagement — Email Sender Platform",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SubscriberPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  const email = params.email?.trim() ?? "";
  if (!email) {
    return (
      <main className="preview-main">
        <header>
          <Link href="/engagement" className="back">
            ← engagement
          </Link>
          <h1>Subscriber engagement</h1>
          <p className="tagline">Missing ?email= query parameter.</p>
        </header>
      </main>
    );
  }

  const events = await getSubscriberEvents(email, 500).catch((err) => {
    console.error("engagement.subscriber_load_failed", err);
    return [];
  });

  return (
    <main className="preview-main">
      <header>
        <Link href="/engagement" className="back">
          ← engagement
        </Link>
        <h1>{email}</h1>
        <p className="tagline">
          {events.length} recorded events
          {events.length >= 500 ? " (showing most recent 500)" : ""}
        </p>
      </header>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 24, fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #e5ded4", textAlign: "left" }}>
            <th style={{ padding: "10px 8px" }}>When</th>
            <th style={{ padding: "10px 8px" }}>Event</th>
            <th style={{ padding: "10px 8px" }}>Brand</th>
            <th style={{ padding: "10px 8px" }}>Issue date</th>
            <th style={{ padding: "10px 8px" }}>Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e, i) => (
            <tr
              key={`${e.eventAt}-${e.eventType}-${i}`}
              style={{ borderBottom: "1px solid #f2ede4" }}
            >
              <td style={{ padding: "10px 8px" }}>{formatDate(e.eventAt)}</td>
              <td style={{ padding: "10px 8px" }}>{e.eventType}</td>
              <td style={{ padding: "10px 8px" }}>
                {e.brand === "saturday_latte"
                  ? "Latte"
                  : e.brand === "daily_grind"
                    ? "Daily Grind"
                    : e.brand ?? "—"}
              </td>
              <td style={{ padding: "10px 8px" }}>{e.issueDate ?? "—"}</td>
              <td style={{ padding: "10px 8px", fontSize: 12, color: "#6a6360" }}>
                {e.eventType === "clicked" && e.clickUrl ? (
                  <a href={e.clickUrl} target="_blank" rel="noreferrer">
                    {e.clickUrl.length > 60 ? `${e.clickUrl.slice(0, 60)}…` : e.clickUrl}
                  </a>
                ) : e.eventType === "bounced" && e.bounceType ? (
                  `${e.bounceType} bounce`
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {events.length === 0 && (
        <p style={{ color: "#9a8b7a", marginTop: 24 }}>
          No events recorded for this address. Either they've never received a tagged send after
          this system deployed, or the Resend webhook isn't yet firing.
        </p>
      )}
    </main>
  );
}
