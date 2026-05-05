import { escapeHtml, withTracking, wrap } from "./shared";
import type { RenderResult, WeekendInput, WeekendSection } from "./types";

function paragraphsToHtml(body: string): string {
  return body
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`)
    .join("\n");
}

function heading(text: string, isFirst: boolean): string {
  return `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:${isFirst ? "0" : "32px"} 0 12px;">${escapeHtml(text)}</div>`;
}

function sectionToHtml(
  s: WeekendSection,
  isFirst: boolean,
  trackingParams: Record<string, string> | undefined,
): string {
  switch (s.kind) {
    case "cover_story":
      return `${heading("Cover Story", isFirst)}<p style="margin:0 0 16px;font-size:18px;font-weight:500;color:#111;">${escapeHtml(s.openingHook)}</p>${paragraphsToHtml(s.body)}`;

    case "tasting_menu": {
      const items = s.items
        .map((it) => {
          const title = it.url
            ? `<a href="${escapeHtml(withTracking(it.url, trackingParams, "tasting_menu"))}" style="color:#111;text-decoration:underline">${escapeHtml(it.title)}</a>`
            : escapeHtml(it.title);
          return `<li style="margin:0 0 12px;"><strong>${title}</strong> — ${escapeHtml(it.summary)}</li>`;
        })
        .join("\n");
      return `${heading("Tasting Menu", isFirst)}<ul style="padding:0 0 0 18px;margin:0;">${items}</ul>`;
    }

    case "hosts_corner":
      return `${heading("Host's Corner", isFirst)}${paragraphsToHtml(s.body)}`;

    case "the_drive":
      return `${heading("The Drive", isFirst)}<p style="margin:0 0 12px;font-size:16px;font-weight:500;">${escapeHtml(s.pick)}</p>${paragraphsToHtml(s.rationale)}`;
  }
}

function renderToText(input: WeekendInput): string {
  const parts: string[] = [`${input.headline}\n\n`];
  for (const s of input.sections) {
    switch (s.kind) {
      case "cover_story":
        parts.push(`## Cover Story\n\n${s.openingHook}\n\n${s.body}\n\n`);
        break;
      case "tasting_menu":
        parts.push("## Tasting Menu\n\n");
        for (const it of s.items) {
          parts.push(`- ${it.title}: ${it.summary}${it.url ? ` (${it.url})` : ""}\n`);
        }
        parts.push("\n");
        break;
      case "hosts_corner":
        parts.push(`## Host's Corner\n\n${s.body}\n\n`);
        break;
      case "the_drive":
        parts.push(`## The Drive\n\n${s.pick}\n\n${s.rationale}\n\n`);
        break;
    }
  }
  parts.push(`---\nunsubscribe: ${input.unsubscribeUrl}\n`);
  return parts.join("");
}

export function renderWeekend(input: WeekendInput): RenderResult {
  const headlineHtml = `<h2 style="margin:0 0 24px;font-size:24px;font-weight:600;line-height:1.3;letter-spacing:-.01em;color:#111;">${escapeHtml(input.headline)}</h2>`;
  const sectionsHtml = input.sections
    .map((s, i) => sectionToHtml(s, i === 0, input.trackingParams))
    .join("\n");
  const body = `${headlineHtml}${sectionsHtml}`;

  const html = wrap({
    brandName: input.brandName,
    preheader: input.preheader,
    body,
    unsubscribeUrl: input.unsubscribeUrl,
    webArchiveUrl: input.webArchiveUrl,
  });

  return {
    html,
    text: renderToText(input),
    subject: input.headline,
    preheader: input.preheader,
  };
}
