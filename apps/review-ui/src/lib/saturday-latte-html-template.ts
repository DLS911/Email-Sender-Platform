/**
 * Saturday Morning Latte HTML email template.
 *
 * Faithful reproduction of the published template at
 * mford4444/castorabbott-website/newsletter/latte/2026-01-22-savannah-*
 *
 * 11 sections + 7 images: Header (with hero image) / Cover Story (with
 * mid-story detail image + inline hyperlinks to real places) / Tasting
 * Menu (3 items, each with image + title link) / Host's Corner (nested
 * box: light outer with image + lead-in, dark inner with white-text
 * move + Learn more link) / The Drive (with image + linked car name) /
 * Sunday Prep / Sunday Reset (centered italic + author) / Sabbath
 * (verse + reference + reflection) / Sign Off / P.S. / Footer.
 */

export type LinkInBody = {
  text: string;
  url: string;
};

export type TastingMenuItem = {
  // "Worth Watching" | "Worth Drinking" | "Worth Reading" | etc.
  label: string;
  title: string;
  body: string;
  // Optional — if present, title renders as a hyperlink.
  url?: string;
  // Optional — if present, an image is shown above the title.
  imageUrl?: string;
};

export type SaturdayLatteContent = {
  coverStoryHeadline: string;
  preheader: string;
  coverStoryParagraphs: string[];
  // Optional — places/links referenced in body. Renderer replaces the first
  // case-insensitive occurrence of each `text` in body paragraphs with a
  // hyperlink to `url`. Used for restaurants, hotels, attractions.
  coverStoryLinks?: LinkInBody[];
  // Image URLs (post-generation). 7 slots, all optional.
  images?: {
    hero?: string;
    coverDetail?: string;
    tastingMenu?: string[]; // up to 3, aligns with tastingMenu array
    hostsCorner?: string;
    theDrive?: string;
  };
  tastingMenu: TastingMenuItem[];
  hostsCorner: {
    leadIn: string;
    moveTitle: string;
    moveBody: string;
    learnMoreUrl?: string;
    learnMoreLabel?: string;
  };
  theDrive: {
    car: string;
    specs: string;
    body: string;
    url?: string;
  };
  sundayPrep: {
    title: string;
    body: string;
  };
  sundayReset: {
    quote: string;
    author: string;
  };
  sabbath: {
    verse: string;
    reference: string;
    reflection: string;
  };
  ps: string;
};

export type RenderInputs = {
  issueDate: string;
  unsubscribeUrl: string;
  webArchiveUrl?: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function injectLinks(escapedHtml: string, links: LinkInBody[] | undefined): string {
  if (!links || links.length === 0) return escapedHtml;
  let out = escapedHtml;
  for (const link of links) {
    if (!link.text || !link.url) continue;
    const escapedText = escapeHtml(link.text);
    // Case-insensitive first-occurrence replace, but only of escaped text in escaped HTML
    const re = new RegExp(`\\b${escapedText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const replacement = `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" style="color: #2d2926; text-decoration: none; border-bottom: 2px solid #c4a882;">$&</a>`;
    out = out.replace(re, replacement);
  }
  return out;
}

function divider(): string {
  return `<tr><td style="padding: 0 48px;"><div style="border-top: 1px solid #e8e4de; margin: 40px 0;"></div></td></tr>`;
}

function renderHeroImage(url: string | undefined, alt: string): string {
  if (!url) return "";
  return `<tr>
  <td style="padding: 0;">
    <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="600" style="display: block; width: 100%; max-width: 600px;">
  </td>
</tr>`;
}

function renderCoverDetailImage(url: string | undefined, alt: string): string {
  if (!url) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0;">
  <tr>
    <td>
      <img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="504" style="display: block; width: 100%; max-width: 504px; border-radius: 8px;">
    </td>
  </tr>
</table>`;
}

function renderTastingMenuItem(item: TastingMenuItem, imageUrl: string | undefined): string {
  const titleHtml = item.url
    ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color: #2d2926; text-decoration: none; border-bottom: 2px solid #c4a882;">${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);
  const imgHtml = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.title)}" width="504" style="display: block; width: 100%; max-width: 504px; border-radius: 8px; margin-bottom: 16px;">`
    : "";
  return `<div style="margin-bottom: 32px;">
  ${imgHtml}
  <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0;">${escapeHtml(item.label)}</p>
  <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #2d2926; margin: 0 0 14px 0; line-height: 1.3;">${titleHtml}</p>
  <p style="color: #4a4540; font-size: 16px; line-height: 1.7; margin: 0;">${escapeHtml(item.body)}</p>
</div>`;
}

function renderHostsCorner(
  hc: SaturdayLatteContent["hostsCorner"],
  imageUrl: string | undefined,
): string {
  const learnMore =
    hc.learnMoreUrl && hc.learnMoreUrl.trim() !== ""
      ? ` <a href="${escapeHtml(hc.learnMoreUrl)}" target="_blank" rel="noopener noreferrer" style="color: #c4a882; text-decoration: none; border-bottom: 1px solid #c4a882;">${escapeHtml(hc.learnMoreLabel ?? "Learn more →")}</a>`
      : "";
  const imgHtml = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(hc.moveTitle)}" width="448" style="display: block; width: 100%; max-width: 448px; border-radius: 8px; margin-bottom: 16px;">`
    : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border-radius: 12px; border: 1px solid #e8e4de;">
  <tr>
    <td style="padding: 28px;">
      ${imgHtml}
      <p style="color: #2d2926; font-size: 16px; margin: 0 0 16px 0;">${escapeHtml(hc.leadIn)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="hc-move" style="background-color: #2d2926; border-radius: 8px;">
        <tr>
          <td style="padding: 20px;">
            <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0;">This Week's Move</p>
            <p class="hc-move-title" style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 700; color: #ffffff; margin: 0 0 14px 0; line-height: 1.3;">${escapeHtml(hc.moveTitle)}</p>
            <p class="hc-move-body" style="color: #e8e4df; font-size: 15px; margin: 0;">${escapeHtml(hc.moveBody)}${learnMore}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

function renderTheDrive(d: SaturdayLatteContent["theDrive"], imageUrl: string | undefined): string {
  const carHtml = d.url
    ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer" style="color: #2d2926; text-decoration: none; border-bottom: 2px solid #c4a882;">${escapeHtml(d.car)}</a>`
    : escapeHtml(d.car);
  const imgHtml = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(d.car)}" width="504" style="display: block; width: 100%; max-width: 504px; border-radius: 8px; margin-bottom: 20px;">`
    : "";
  return `${imgHtml}<p style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #2d2926; margin: 0 0 8px 0;">${carHtml}</p>
<p style="font-size: 13px; color: #9a8b7a; font-style: italic; margin: 0 0 18px 0;">${escapeHtml(d.specs)}</p>
<p style="color: #4a4540; font-size: 16px; line-height: 1.7; margin: 0;">${escapeHtml(d.body)}</p>`;
}

export function renderSaturdayLatteHtml(
  content: SaturdayLatteContent,
  inputs: RenderInputs,
): { html: string; text: string; subject: string; preheader: string } {
  const subject = content.coverStoryHeadline;
  const images = content.images ?? {};

  // Cover story paragraphs with inline hyperlink injection
  const coverParas = content.coverStoryParagraphs
    .map((p) => {
      const escaped = escapeHtml(p);
      const withLinks = injectLinks(escaped, content.coverStoryLinks);
      return `<p style="margin: 0 0 16px 0;">${withLinks}</p>`;
    })
    .join("\n");

  // Insert the cover detail image after the 2nd paragraph (if present)
  const coverParasWithImage = (() => {
    if (!images.coverDetail) return coverParas;
    const paras = content.coverStoryParagraphs.map((p) => {
      const escaped = escapeHtml(p);
      return `<p style="margin: 0 0 16px 0;">${injectLinks(escaped, content.coverStoryLinks)}</p>`;
    });
    const insertAt = Math.min(2, paras.length);
    const out: string[] = [];
    for (let i = 0; i < paras.length; i++) {
      out.push(paras[i]!);
      if (i + 1 === insertAt) {
        out.push(renderCoverDetailImage(images.coverDetail, content.coverStoryHeadline));
      }
    }
    return out.join("\n");
  })();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Saturday Morning Latte</title>
  <style>
    @media only screen and (max-width: 600px) {
      .hc-move { background-color: #faf8f5 !important; }
      .hc-move-title { color: #2d2926 !important; }
      .hc-move-body { color: #4a4540 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #faf9f7; color: #2d2926; line-height: 1.8; font-size: 17px;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(content.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf9f7;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">

          <!-- HEADER -->
          <tr>
            <td style="background-color: #2d2926; padding: 36px 48px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="center">
                    <p style="margin: 0 0 8px 0;">
                      <span style="font-size: 28px;">☕</span>
                      <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #c4a882; vertical-align: middle; margin-left: 12px;">The Saturday Morning Latte</span>
                    </p>
                    <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 14px; font-style: italic; color: #9a8b7a; margin: 0 0 12px 0;">The weekend read for advisors who&#039;ve figured some things out</p>
                    <p style="font-size: 13px; color: #9a8b7a; margin: 0;">${escapeHtml(inputs.issueDate)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${renderHeroImage(images.hero, content.coverStoryHeadline)}

          <!-- COVER STORY -->
          <tr>
            <td style="padding: 44px 48px 0 48px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 6px 0;">Cover Story</p>
              <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 32px; font-weight: 700; color: #2d2926; line-height: 1.25; margin: 0 0 28px 0;">${escapeHtml(content.coverStoryHeadline)}</h1>
              ${coverParasWithImage}
            </td>
          </tr>

          ${divider()}

          <!-- TASTING MENU -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 6px 0;">The Tasting Menu</p>
              <p style="font-size: 14px; color: #9a8b7a; font-style: italic; margin: 0 0 28px 0;">What&#039;s worth your time this weekend.</p>
              ${content.tastingMenu.map((item, i) => renderTastingMenuItem(item, images.tastingMenu?.[i])).join("\n")}
            </td>
          </tr>

          ${divider()}

          <!-- HOST'S CORNER -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 6px 0;">The Host&#039;s Corner</p>
              <p style="font-size: 14px; color: #9a8b7a; font-style: italic; margin: 0 0 24px 0;">From our kitchen to yours.</p>
              ${renderHostsCorner(content.hostsCorner, images.hostsCorner)}
            </td>
          </tr>

          ${divider()}

          <!-- THE DRIVE -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 24px 0;">The Drive</p>
              ${renderTheDrive(content.theDrive, images.theDrive)}
            </td>
          </tr>

          ${divider()}

          <!-- SUNDAY PREP -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 6px 0;">Sunday Prep</p>
              <p style="font-size: 14px; color: #9a8b7a; font-style: italic; margin: 0 0 24px 0;">One thing to do tonight for the week ahead.</p>
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 700; color: #2d2926; margin: 0 0 12px 0;">${escapeHtml(content.sundayPrep.title)}</p>
              <p style="color: #4a4540; font-size: 16px; line-height: 1.7; margin: 0;">${escapeHtml(content.sundayPrep.body)}</p>
            </td>
          </tr>

          ${divider()}

          <!-- SUNDAY RESET -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 24px 0;">Sunday Reset</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border-top: 1px solid #e8e4de; border-bottom: 1px solid #e8e4de;">
                <tr>
                  <td style="padding: 32px; text-align: center;">
                    <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 19px; font-style: italic; color: #2d2926; margin: 0 0 14px 0; line-height: 1.5;">&ldquo;${escapeHtml(content.sundayReset.quote)}&rdquo;</p>
                    <p style="font-size: 14px; color: #9a8b7a; margin: 0;">&mdash; ${escapeHtml(content.sundayReset.author)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${divider()}

          <!-- SABBATH -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 24px 0;">Sabbath</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border-top: 1px solid #e8e4de; border-bottom: 1px solid #e8e4de;">
                <tr>
                  <td style="padding: 32px; text-align: center;">
                    <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-style: italic; color: #2d2926; margin: 0 0 8px 0; line-height: 1.5;">&ldquo;${escapeHtml(content.sabbath.verse)}&rdquo;</p>
                    <p style="font-size: 13px; color: #9a8b7a; margin: 0 0 18px 0;">&mdash; ${escapeHtml(content.sabbath.reference)}</p>
                    <p style="font-size: 15px; color: #4a4540; margin: 0; line-height: 1.7;">${escapeHtml(content.sabbath.reflection)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SIGN OFF -->
          <tr>
            <td style="padding: 44px 48px 20px 48px;">
              <p style="margin: 0 0 4px 0; font-size: 17px; line-height: 1.7; color: #4a4540;">Enjoy the weekend,</p>
              <p style="margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 19px; font-weight: 700; color: #2d2926;">Mark ☕</p>
            </td>
          </tr>

          <!-- P.S. -->
          <tr>
            <td style="padding: 0 48px 48px 48px;">
              <p style="font-size: 14px; color: #6b6560; margin: 0;"><strong style="color: #4a4540;">P.S.</strong> ${escapeHtml(content.ps)}</p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color: #faf8f5; padding: 28px 48px; border-top: 1px solid #e8e4de; text-align: center;">
              <p style="margin: 0 0 12px 0;">
                <a href="${escapeHtml(inputs.webArchiveUrl ?? "https://castorabbott.com/newsletter/latte/")}" style="color: #9a8b7a; text-decoration: none; font-size: 13px; margin: 0 12px;">View in browser</a>
                <a href="${escapeHtml(inputs.unsubscribeUrl)}" style="color: #9a8b7a; text-decoration: none; font-size: 13px; margin: 0 12px;">Unsubscribe</a>
              </p>
              <p style="font-size: 12px; color: #9a8b7a; margin: 0;">The Saturday Morning Latte &bull; The weekend read for advisors who&#039;ve figured some things out</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    html,
    text: renderText(content, inputs),
    subject,
    preheader: content.preheader,
  };
}

function renderText(content: SaturdayLatteContent, inputs: RenderInputs): string {
  const lines: string[] = [];
  lines.push("THE SATURDAY MORNING LATTE");
  lines.push(`The weekend read for advisors who've figured some things out`);
  lines.push(inputs.issueDate);
  lines.push("");
  lines.push("=== COVER STORY ===");
  lines.push("");
  lines.push(content.coverStoryHeadline.toUpperCase());
  lines.push("");
  for (const p of content.coverStoryParagraphs) {
    lines.push(p);
    lines.push("");
  }
  lines.push("=== THE TASTING MENU ===");
  lines.push("");
  for (const item of content.tastingMenu) {
    const url = item.url ? ` (${item.url})` : "";
    lines.push(`[${item.label.toUpperCase()}] ${item.title}${url}`);
    lines.push(item.body);
    lines.push("");
  }
  lines.push("=== THE HOST'S CORNER ===");
  lines.push("");
  lines.push(content.hostsCorner.leadIn);
  lines.push("");
  lines.push(`THIS WEEK'S MOVE: ${content.hostsCorner.moveTitle}`);
  lines.push(content.hostsCorner.moveBody);
  if (content.hostsCorner.learnMoreUrl) {
    lines.push(`Learn more: ${content.hostsCorner.learnMoreUrl}`);
  }
  lines.push("");
  lines.push("=== THE DRIVE ===");
  lines.push("");
  const carLine = content.theDrive.url
    ? `${content.theDrive.car} (${content.theDrive.url})`
    : content.theDrive.car;
  lines.push(carLine);
  lines.push(content.theDrive.specs);
  lines.push("");
  lines.push(content.theDrive.body);
  lines.push("");
  lines.push("=== SUNDAY PREP ===");
  lines.push("");
  lines.push(content.sundayPrep.title);
  lines.push(content.sundayPrep.body);
  lines.push("");
  lines.push("=== SUNDAY RESET ===");
  lines.push("");
  lines.push(`"${content.sundayReset.quote}"`);
  lines.push(`— ${content.sundayReset.author}`);
  lines.push("");
  lines.push("=== SABBATH ===");
  lines.push("");
  lines.push(`"${content.sabbath.verse}"`);
  lines.push(`— ${content.sabbath.reference}`);
  lines.push("");
  lines.push(content.sabbath.reflection);
  lines.push("");
  lines.push("Enjoy the weekend,");
  lines.push("Mark");
  lines.push("");
  lines.push(`P.S. ${content.ps}`);
  lines.push("");
  lines.push(`Unsubscribe: ${inputs.unsubscribeUrl}`);
  return lines.join("\n");
}
