import { escapeHtml, wrap } from "./shared";
import type { RenderResult, WeekdayInput, WeekdaySection } from "./types";

function paragraphsToHtml(body: string): string {
  return body
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p)}</p>`)
    .join("\n");
}

function sectionToHtml(s: WeekdaySection, isFirst: boolean): string {
  const heading = `<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:${isFirst ? "0" : "32px"} 0 12px;">${escapeHtml(s.name)}</div>`;
  return `${heading}${paragraphsToHtml(s.body)}`;
}

function renderToText(input: WeekdayInput): string {
  const parts: string[] = [`${input.headline}\n\n`];
  for (const s of input.sections) {
    parts.push(`## ${s.name}\n\n${s.body}\n\n`);
  }
  parts.push(`---\nunsubscribe: ${input.unsubscribeUrl}\n`);
  return parts.join("");
}

export function renderWeekday(input: WeekdayInput): RenderResult {
  const headlineHtml = `<h2 style="margin:0 0 24px;font-size:24px;font-weight:600;line-height:1.3;letter-spacing:-.01em;color:#111;">${escapeHtml(input.headline)}</h2>`;
  const sectionsHtml = input.sections.map((s, i) => sectionToHtml(s, i === 0)).join("\n");
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
