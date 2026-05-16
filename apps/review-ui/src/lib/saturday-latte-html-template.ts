/**
 * Saturday Morning Latte HTML email template.
 *
 * Faithful reproduction of the published template at
 * mford4444/castorabbott-website/newsletter/latte/2026-01-22-savannah-*
 *
 * 11 sections: Header / Cover Story / Tasting Menu / Host's Corner /
 * The Drive / Sunday Prep / Sunday Reset / Sabbath / Sign Off / P.S. /
 * Footer. No sponsor block in the Latte.
 */

export type TastingMenuItem = {
  // "Worth Watching" | "Worth Drinking" | "Worth Reading" | etc.
  label: string;
  title: string;
  body: string;
};

export type HostsCornerStep = {
  label: string;
  body: string;
};

export type SaturdayLatteContent = {
  coverStoryHeadline: string;
  preheader: string;
  coverStoryParagraphs: string[];
  tastingMenu: TastingMenuItem[];
  hostsCorner: {
    leadIn: string;
    moveTitle: string;
    moveBody: string;
  };
  theDrive: {
    car: string;
    specs: string;
    body: string;
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

function paragraphs(text: string, paraStyle = ""): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p style="margin: 0 0 16px 0;${paraStyle ? ` ${paraStyle}` : ""}">${escapeHtml(p.trim())}</p>`)
    .join("\n");
}

function divider(): string {
  return `<tr><td style="padding: 0 48px;"><div style="border-top: 1px solid #e8e4de; margin: 40px 0;"></div></td></tr>`;
}

function renderTastingMenuItem(item: TastingMenuItem): string {
  return `<div style="margin-bottom: 32px;">
  <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0;">${escapeHtml(item.label)}</p>
  <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #2d2926; margin: 0 0 14px 0; line-height: 1.3;">${escapeHtml(item.title)}</p>
  <p style="color: #4a4540; font-size: 16px; line-height: 1.7; margin: 0;">${escapeHtml(item.body)}</p>
</div>`;
}

function renderHostsCorner(hc: { leadIn: string; moveTitle: string; moveBody: string }): string {
  return `<p style="color: #4a4540; font-size: 16px; line-height: 1.7; margin: 0 0 20px 0;">${escapeHtml(hc.leadIn)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border: 1px solid #e8e4de; border-left: 4px solid #c4a882; margin: 24px 0;">
  <tr>
    <td style="padding: 28px;">
      <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0;">This Week's Move</p>
      <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #2d2926; margin: 0 0 16px 0; line-height: 1.3;">${escapeHtml(hc.moveTitle)}</p>
      <p style="color: #4a4540; font-size: 16px; line-height: 1.7; margin: 0;">${escapeHtml(hc.moveBody)}</p>
    </td>
  </tr>
</table>`;
}

export function renderSaturdayLatteHtml(
  content: SaturdayLatteContent,
  inputs: RenderInputs,
): { html: string; text: string; subject: string; preheader: string } {
  const subject = content.coverStoryHeadline;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Saturday Morning Latte</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #faf9f7; color: #2d2926; line-height: 1.8; font-size: 17px;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(content.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf9f7;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">

          <!-- HEADER -->
          <tr>
            <td style="background-color: #2d2926; padding: 36px 48px; border-radius: 0 0 12px 12px;">
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

          <!-- COVER STORY -->
          <tr>
            <td style="padding: 44px 48px 0 48px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 6px 0;">Cover Story</p>
              <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 32px; font-weight: 700; color: #2d2926; line-height: 1.25; margin: 0 0 28px 0;">${escapeHtml(content.coverStoryHeadline)}</h1>
              ${content.coverStoryParagraphs.map((p) => `<p style="margin: 0 0 16px 0;">${escapeHtml(p)}</p>`).join("\n")}
            </td>
          </tr>

          ${divider()}

          <!-- TASTING MENU -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 6px 0;">The Tasting Menu</p>
              <p style="font-size: 14px; color: #9a8b7a; font-style: italic; margin: 0 0 28px 0;">What&#039;s worth your time this weekend.</p>
              ${content.tastingMenu.map(renderTastingMenuItem).join("\n")}
            </td>
          </tr>

          ${divider()}

          <!-- HOST'S CORNER -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 6px 0;">The Host&#039;s Corner</p>
              <p style="font-size: 14px; color: #9a8b7a; font-style: italic; margin: 0 0 24px 0;">From our kitchen to yours.</p>
              ${renderHostsCorner(content.hostsCorner)}
            </td>
          </tr>

          ${divider()}

          <!-- THE DRIVE -->
          <tr>
            <td style="padding: 0 48px;">
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 26px; font-weight: 700; color: #2d2926; margin: 0 0 6px 0;">The Drive</p>
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #2d2926; margin: 24px 0 8px 0;">${escapeHtml(content.theDrive.car)}</p>
              <p style="font-size: 13px; color: #9a8b7a; font-style: italic; margin: 0 0 18px 0;">${escapeHtml(content.theDrive.specs)}</p>
              <p style="color: #4a4540; font-size: 16px; line-height: 1.7; margin: 0;">${escapeHtml(content.theDrive.body)}</p>
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
    lines.push(`[${item.label.toUpperCase()}] ${item.title}`);
    lines.push(item.body);
    lines.push("");
  }
  lines.push("=== THE HOST'S CORNER ===");
  lines.push("");
  lines.push(content.hostsCorner.leadIn);
  lines.push("");
  lines.push(`THIS WEEK'S MOVE: ${content.hostsCorner.moveTitle}`);
  lines.push(content.hostsCorner.moveBody);
  lines.push("");
  lines.push("=== THE DRIVE ===");
  lines.push("");
  lines.push(content.theDrive.car);
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
