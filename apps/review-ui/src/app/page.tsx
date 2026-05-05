export default function HomePage() {
  return (
    <main>
      <header>
        <h1>Email Sender Platform</h1>
        <p className="tagline">Multi-brand agentic content + distribution + learning.</p>
      </header>

      <section className="card">
        <h2>Status</h2>
        <p>
          Review interface scaffold deployed. The full inbox, episode editor, quality score panel,
          and approval workflow ship per <code>docs/specs/08_review_interface.spec.md</code>.
        </p>
        <p>
          <a href="/inbox">→ View mock inbox</a>
        </p>
      </section>

      <section className="card">
        <h2>What lives here</h2>
        <ul>
          <li>Pending-review inbox (drafts awaiting human approval)</li>
          <li>Episode editor with edit-in-place</li>
          <li>Quality score panel — persona panel, hard stops, benchmark comparison</li>
          <li>Approve &amp; schedule, send now, save &amp; re-review, reject &amp; regenerate</li>
          <li>Voice module browser with version history</li>
        </ul>
      </section>

      <section className="card">
        <h2>Brands</h2>
        <p>Phase 1: Castor Abbott. Phase 4: Fidelon. Phase 5: Treasure Financial + Cortex.</p>
      </section>

      <footer>
        <p>
          See <code>docs/specs/00_overview.spec.md</code> for the full architecture.
        </p>
      </footer>
    </main>
  );
}
