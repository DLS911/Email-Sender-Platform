import {
  type RenderResult,
  type WeekendSection,
  renderWeekday,
  renderWeekend,
} from "@platform/email-templates";
import type { MockEpisode } from "./mock-episodes";

/**
 * Map a mock episode to email-template input. The real pipeline writes
 * structured section content; this adapter maps the inbox/episode mock
 * shape into the rendering shape that @platform/email-templates expects.
 */
export function renderMockEpisodeAsEmail(episode: MockEpisode): RenderResult {
  const preheader = episode.headline.slice(0, 110);
  const unsubscribeUrl = `https://mail.castorabbott.com/u/${episode.id}`;
  const archiveUrl = `https://castorabbott.com/archive/${episode.id}`;

  if (episode.edition === "weekday") {
    return renderWeekday({
      brandName: episode.brandName,
      brandSlug: episode.brandId,
      episodeId: episode.id,
      headline: episode.headline,
      preheader,
      contentType: episode.contentType,
      sections: episode.sections.map((s) => ({ name: s.name, body: s.body })),
      unsubscribeUrl,
      webArchiveUrl: archiveUrl,
    });
  }

  // Map weekend section names to typed weekend sections.
  const weekendSections: WeekendSection[] = [];
  for (const s of episode.sections) {
    const name = s.name.toLowerCase();
    if (name.includes("cover")) {
      const [hook, ...rest] = s.body.split(/\n\n+/);
      weekendSections.push({
        kind: "cover_story",
        openingHook: hook ?? s.body,
        body: rest.join("\n\n"),
      });
    } else if (name.includes("tasting") || name.includes("menu")) {
      const items = s.body
        .split(/\n+/)
        .filter((line) => line.trim().startsWith("-"))
        .map((line) => {
          const cleaned = line.replace(/^-\s*/, "").trim();
          const [title, ...rest] = cleaned.split(":");
          return {
            title: (title ?? cleaned).trim(),
            summary: rest.join(":").trim() || cleaned,
          };
        });
      if (items.length > 0) weekendSections.push({ kind: "tasting_menu", items });
    } else if (name.includes("drive")) {
      const [pick, ...rest] = s.body.split(/\n\n+/);
      weekendSections.push({
        kind: "the_drive",
        pick: pick ?? s.body,
        rationale: rest.join("\n\n"),
      });
    } else {
      weekendSections.push({ kind: "hosts_corner", body: s.body });
    }
  }

  return renderWeekend({
    brandName: episode.brandName,
    brandSlug: episode.brandId,
    episodeId: episode.id,
    headline: episode.headline,
    preheader,
    contentType: episode.contentType,
    sections: weekendSections,
    unsubscribeUrl,
    webArchiveUrl: archiveUrl,
  });
}
