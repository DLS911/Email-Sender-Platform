import { renderMockEpisodeAsEmail } from "@/lib/episode-to-email";
import { getMockEpisode, listMockEpisodeIds } from "@/lib/mock-episodes";
import Link from "next/link";
import { notFound } from "next/navigation";

export function generateStaticParams() {
  return listMockEpisodeIds().map((id) => ({ id }));
}

type Params = Promise<{ id: string }>;

export default async function PreviewPage({ params }: { params: Params }) {
  const { id } = await params;
  const episode = getMockEpisode(id);
  if (!episode) notFound();

  const rendered = renderMockEpisodeAsEmail(episode);

  return (
    <main className="preview-main">
      <header>
        <Link href={`/episodes/${id}` as never} className="back">
          ← back to episode
        </Link>
        <h1>Email preview</h1>
        <p className="tagline">
          {episode.brandName} · {episode.edition} · ships{" "}
          {new Date(episode.scheduledSendAt).toLocaleDateString()}
        </p>
      </header>

      <section className="card">
        <h2>Subject + preheader</h2>
        <p className="preview-subject">{rendered.subject}</p>
        <p className="preview-preheader">{rendered.preheader}</p>
      </section>

      <section className="card preview-frame-card">
        <h2>HTML render</h2>
        <iframe title="email preview" className="email-iframe" srcDoc={rendered.html} sandbox="" />
      </section>

      <section className="card">
        <h2>Plain-text render</h2>
        <pre className="text-render">{rendered.text}</pre>
      </section>

      <footer>
        <p>
          Rendered by <code>@platform/email-templates</code> from mock episode data. Real
          subscribers receive these via Resend per{" "}
          <code>docs/specs/06_distribution_platform.spec.md</code>.
        </p>
      </footer>
    </main>
  );
}
