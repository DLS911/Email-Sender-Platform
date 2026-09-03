/**
 * Curated lists admin page. Four tabs (cars, drinks, books, products).
 * Each tab: list of curated items, add form, mark-used / archive
 * controls. Items marked "active" are injected into the writer's
 * prompt as a PRIORITY CURATED LIST that the writer MUST pick from.
 *
 *   /admin/latte/curated?test=<CRON_SECRET>
 */

import Link from "next/link";
import { CuratedTabs } from "./CuratedTabs";

export const dynamic = "force-dynamic";

function isAuthorized(test: string | undefined): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return test === cronSecret;
}

export default async function CuratedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const testParam = typeof sp.test === "string" ? sp.test : undefined;
  if (!isAuthorized(testParam)) {
    return (
      <main style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <h1>Curated lists</h1>
        <p>Unauthorized. Append <code>?test=&lt;CRON_SECRET&gt;</code>.</p>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <Link href={`/admin/latte?test=${testParam}`} style={{ color: "#0a5fb8", fontSize: 13, textDecoration: "none" }}>
        ← issues
      </Link>
      <h1 style={{ margin: "8px 0 4px 0" }}>Curated lists</h1>
      <p style={{ color: "#666", fontSize: 14, margin: "0 0 24px 0" }}>
        Items you add here take PRIORITY over shelf / research picks. The writer sees this list on every fire and must pick from it when it has active items for a kind. When an issue publishes with a curated item, its status flips to <b>used</b> automatically.
      </p>
      <CuratedTabs testSecret={testParam ?? ""} />
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  maxWidth: 1100,
  margin: "0 auto",
};
