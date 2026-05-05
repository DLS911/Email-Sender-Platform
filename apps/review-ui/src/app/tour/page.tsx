import Link from "next/link";

export const metadata = {
  title: "Tour — Email Sender Platform",
};

type RowStatus = "wired" | "mocked" | "blocked-on-secrets" | "blocked-on-services";

const STATUS_LABEL: Record<RowStatus, string> = {
  wired: "wired",
  mocked: "mocked",
  "blocked-on-secrets": "needs API keys",
  "blocked-on-services": "needs Supabase",
};

const STATUS_PILL: Record<RowStatus, string> = {
  wired: "pill pill-pass",
  mocked: "pill pill-experimental",
  "blocked-on-secrets": "pill pill-fail",
  "blocked-on-services": "pill pill-fail",
};

type Row = { what: string; where: string; status: RowStatus; note?: string };

const SECTIONS: Array<{ heading: string; rows: Row[] }> = [
  {
    heading: "Foundation (always works)",
    rows: [
      {
        what: "TypeScript strict, pnpm workspaces, Biome",
        where: "tsconfig.base.json, biome.json",
        status: "wired",
      },
      {
        what: "Vercel deploy of review-ui",
        where: "vercel.json",
        status: "wired",
      },
      {
        what: "GitHub Actions CI",
        where: ".github/workflows/ci.yml",
        status: "wired",
      },
      {
        what: "Pure-function libs (auto-heal, voice composer, quality gate, variety, svix verify)",
        where: "packages/{llm-client,voice-modules,brain,distribution}",
        status: "wired",
        note: "106 unit tests passing",
      },
    ],
  },
  {
    heading: "Pipeline (architecture wired, blocks mocked)",
    rows: [
      {
        what: "Orchestrator wiring all 9 blocks end-to-end",
        where: "apps/pipeline/src/orchestrator.ts",
        status: "wired",
        note: "6 integration tests with mock blocks",
      },
      {
        what: "Mock block bundle producing real HTML output",
        where: "apps/pipeline/src/blocks/mock.ts",
        status: "wired",
      },
      {
        what: "Real LLM blocks (anthropic/openai/google adapters)",
        where: "packages/llm-client/src/providers/",
        status: "blocked-on-secrets",
        note: "needs ANTHROPIC_API_KEY, etc.",
      },
      {
        what: "Brain reads/writes against pgvector",
        where: "packages/brain/src/concept-{check,extract}.ts",
        status: "blocked-on-services",
        note: "stubs return correct shape; SQL pattern documented inline",
      },
    ],
  },
  {
    heading: "Distribution",
    rows: [
      {
        what: "DistributionProvider abstraction + Resend adapter shape",
        where: "packages/distribution/src/",
        status: "wired",
      },
      {
        what: "Webhook signature verification (Svix HMAC-SHA256)",
        where: "packages/distribution/src/svix.ts",
        status: "wired",
        note: "8 sig verify + 8 webhook parse tests",
      },
      {
        what: "Actual sending via Resend",
        where: "packages/distribution/src/providers/resend.ts",
        status: "blocked-on-secrets",
        note: "needs RESEND_API_KEY + verified sending domain",
      },
      {
        what: "Subscriber + suppression imports",
        where: "apps/pipeline/src/scripts/migrate-subscribers.ts",
        status: "blocked-on-services",
        note: "CSV parsing + row mapping fully tested; insert blocked on Supabase",
      },
    ],
  },
  {
    heading: "Email rendering",
    rows: [
      {
        what: "Weekday + weekend HTML templates with link tracking",
        where: "packages/email-templates/",
        status: "wired",
        note: "6 tests; XSS-escaped; section-level utm attribution",
      },
      {
        what: "Live email preview against mock episodes",
        where: "/episodes/[id]/preview",
        status: "wired",
        note: "iframe + plain-text + subject/preheader",
      },
    ],
  },
  {
    heading: "Review UI (mock data on Vercel)",
    rows: [
      {
        what: "Multi-brand inbox with brand filter",
        where: "/inbox",
        status: "mocked",
        note: "6 mock episodes across 4 brands",
      },
      {
        what: "Episode detail with persona panel + flags + sections",
        where: "/episodes/[id]",
        status: "mocked",
      },
      {
        what: "Pipeline run viewer with block-by-block table",
        where: "/runs and /runs/[id]",
        status: "mocked",
        note: "shows fallback + retry rendering",
      },
      {
        what: "Voice module browser",
        where: "/voice",
        status: "wired",
        note: "reads real markdown from packages/voice-modules at build",
      },
      {
        what: "Voice composition viewer",
        where: "/voice/composition",
        status: "wired",
        note: "Castor Abbott v1 brand_voice_config",
      },
      {
        what: "Persona profile pages",
        where: "/voice/personas/[slug]",
        status: "wired",
        note: "10 prerendered routes from real persona markdown",
      },
      {
        what: "Brain concept browser",
        where: "/concepts",
        status: "mocked",
        note: "framework + content concepts visualized",
      },
      {
        what: "Engagement stats dashboard",
        where: "/stats",
        status: "mocked",
        note: "per-brand rollups + recent sends",
      },
    ],
  },
  {
    heading: "Database schema (ready, not yet applied)",
    rows: [
      {
        what: "Initial schema + RLS + advisory locks + seed",
        where: "infra/supabase/migrations/",
        status: "blocked-on-services",
        note: "5 SQL files; 4 brands + 11 default model roles seeded",
      },
    ],
  },
];

export default function TourPage() {
  return (
    <main className="preview-main">
      <header>
        <Link href="/" className="back">
          ← back
        </Link>
        <h1>What's wired vs. what's coming</h1>
        <p className="tagline">
          A guided tour of the deploy state. Pieces marked "wired" run for real today; "mocked" uses
          canned data while waiting for Supabase or external services.
        </p>
      </header>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="card">
          <h2>{section.heading}</h2>
          <table className="persona-table">
            <thead>
              <tr>
                <th>What</th>
                <th>Where</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.what}>
                  <td>
                    <div>{row.what}</div>
                    {row.note && (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        {row.note}
                      </div>
                    )}
                  </td>
                  <td className="persona-name">
                    <code>{row.where}</code>
                  </td>
                  <td>
                    <span className={STATUS_PILL[row.status]}>{STATUS_LABEL[row.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="card">
        <h2>What you (Mark) need to do for the next layer to come alive</h2>
        <ol style={{ paddingLeft: 20 }}>
          <li>
            Create the Supabase project. Apply migrations from{" "}
            <code>infra/supabase/migrations/</code>. Drop the URL + service-role key into Vercel
            env. The brain stubs become real, run rows show up in <code>/runs</code>, the inbox
            shows real drafts.
          </li>
          <li>
            Verify <code>mail.castorabbott.com</code> in Resend. Drop the API key + signing secret
            into Vercel env. Distribution is then live.
          </li>
          <li>
            Drop in <code>ANTHROPIC_API_KEY</code> (and OpenAI for embeddings). The pipeline can run
            real blocks instead of mocks.
          </li>
          <li>
            Run subscriber + concept imports per <code>docs/runbooks/phase-0-ops.md</code>. Brain
            now has 270 days of lockout history; subscribers are loaded.
          </li>
        </ol>
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          Each step is independent — Supabase alone unblocks 60% of the mocked items.
        </p>
      </section>
    </main>
  );
}
