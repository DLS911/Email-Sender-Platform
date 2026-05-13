/**
 * Daily Grind HTML email template.
 *
 * Faithful reproduction of the published Daily Grind structure as seen in
 * mford4444/castorabbott-website/newsletter/grind/ (e.g. 2026-02-25-*).
 * Every visual element from the reference issue is here: opening trifecta,
 * First Pull, Worth Knowing with stat callouts, sponsor block, the tactic
 * with how-to box, Grounds for Thought, Ancient Truth, sign-off, P.S., footer.
 *
 * Styles are inline (email-safe). Table-based layout for client compatibility.
 */

export type DailyGrindContentType = "tactic" | "take" | "story" | "rant" | "special";

export type WorthKnowingItem = {
  category: string;
  headline: string;
  stat?: string;
  statLabel?: string;
  statColor?: "green" | "red" | "gold";
  sourceUrl: string;
  sourceName?: string;
  publishedDate?: string;
  body: string;
  myTake: string;
};

export type HowToStep = {
  label: string;
  body: string;
};

export type DailyGrindContent = {
  headline: string;
  preheader: string;
  contentType: DailyGrindContentType;
  openingTrifecta: {
    theNumber: { stat: string; description: string };
    theUnspoken: string;
    theFlip: { conventional: string; reality: string };
  };
  firstPull: { paragraphs: string[] };
  worthKnowing: WorthKnowingItem[];
  mainContent: {
    subhead: string;
    intro: string;
    howTo: { title: string; steps: HowToStep[] };
    closing: string;
  };
  groundsForThought: string;
  ancientTruth: { verse: string; reference: string; application: string };
  ps: string;
};

export type RenderInputs = {
  issueDate: string;
  unsubscribeUrl: string;
  webArchiveUrl?: string;
};

const COLOR_MAP: Record<"green" | "red" | "gold", string> = {
  green: "#5a9a6a",
  red: "#c45a4a",
  gold: "#c4a882",
};

const CONTENT_TYPE_LABEL: Record<DailyGrindContentType, string> = {
  tactic: "The Tactic",
  take: "The Take",
  story: "The Story",
  rant: "The Rant",
  special: "The Special",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function paragraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => `<p style="margin: 0 0 14px 0; color: #4a4540;">${escapeHtml(p.trim())}</p>`)
    .join("\n");
}

function renderTheNumber(theNumber: { stat: string; description: string }): string {
  return `<tr>
  <td style="padding: 20px 24px; border-bottom: 1px solid #e8e4de;">
    <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0;">The Number</p>
    <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 32px; font-weight: 700; color: #c4a882; margin: 0 0 8px 0; line-height: 1;">${escapeHtml(theNumber.stat)}</p>
    <p style="font-size: 15px; color: #4a4540; margin: 0;">${escapeHtml(theNumber.description)}</p>
  </td>
</tr>`;
}

function renderTheUnspoken(text: string): string {
  return `<tr>
  <td style="padding: 20px 24px; border-bottom: 1px solid #e8e4de;">
    <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0;">The Unspoken</p>
    <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px; font-style: italic; color: #2d2926; margin: 0; line-height: 1.5;">${escapeHtml(text)}</p>
  </td>
</tr>`;
}

function renderTheFlip(flip: { conventional: string; reality: string }): string {
  return `<tr>
  <td style="padding: 20px 24px;">
    <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 8px 0;">The Flip</p>
    <p style="font-size: 14px; color: #6b6560; margin: 0 0 6px 0;"><strong style="color: #9a8b7a;">Conventional:</strong> "${escapeHtml(flip.conventional)}"</p>
    <p style="font-size: 14px; color: #4a4540; margin: 0;"><strong style="color: #2d2926;">Reality:</strong> ${escapeHtml(flip.reality)}</p>
  </td>
</tr>`;
}

function renderWorthKnowingItem(item: WorthKnowingItem, isLast: boolean): string {
  const margin = isLast ? "margin-bottom: 0;" : "margin-bottom: 28px;";
  let statBlock = "";
  if (item.stat && item.statLabel) {
    const color = COLOR_MAP[item.statColor ?? "gold"];
    statBlock = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 0 0 16px 0;">
  <tr>
    <td style="background-color: #faf8f5; border-left: 4px solid ${color}; padding: 16px; text-align: center;">
      <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 36px; font-weight: 700; color: #2d2926; margin: 0 0 4px 0; line-height: 1;">${escapeHtml(item.stat)}</p>
      <p style="font-size: 13px; color: #6b6560; margin: 0; line-height: 1.4;">${escapeHtml(item.statLabel)}</p>
    </td>
  </tr>
</table>`;
  }
  const headlineHtml = item.sourceUrl
    ? `<a href="${escapeHtml(item.sourceUrl)}" style="color: #2d2926; text-decoration: none;">${escapeHtml(item.headline)}</a>`
    : escapeHtml(item.headline);

  const attributionBits: string[] = [];
  if (item.sourceName) attributionBits.push(escapeHtml(item.sourceName));
  if (item.publishedDate) attributionBits.push(escapeHtml(item.publishedDate));
  const sourceLine =
    attributionBits.length > 0 && item.sourceUrl
      ? `<p style="font-size: 12px; color: #9a8b7a; margin: 0 0 10px 0;"><a href="${escapeHtml(item.sourceUrl)}" style="color: #9a8b7a; text-decoration: none;">${attributionBits.join(" &bull; ")} &rarr;</a></p>`
      : "";

  return `<div style="${margin}">
  <p style="font-size: 11px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 1.5px; margin: 0 0 6px 0;">${escapeHtml(item.category)}</p>
  <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 700; color: #2d2926; margin: 0 0 6px 0;">${headlineHtml}</p>
  ${sourceLine}
  ${statBlock}
  <p style="color: #4a4540; font-size: 15px; margin: 0 0 12px 0;">${escapeHtml(item.body)}</p>
  <p style="font-style: italic; color: #6b6560; font-size: 14px; padding-left: 16px; border-left: 2px solid #c4a882; margin: 0;"><strong>My take:</strong> ${escapeHtml(item.myTake)}</p>
</div>`;
}

function renderHowToBox(howTo: { title: string; steps: HowToStep[] }): string {
  const stepsHtml = howTo.steps
    .map(
      (s) =>
        `<p style="margin: 0 0 12px 0; color: #4a4540;"><strong>${escapeHtml(s.label)}:</strong> ${escapeHtml(s.body)}</p>`,
    )
    .join("\n");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border: 1px solid #e8e4de; border-left: 4px solid #c4a882; margin: 24px 0;">
  <tr>
    <td style="padding: 24px;">
      <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 700; color: #2d2926; margin: 0 0 16px 0;">${escapeHtml(howTo.title)}</p>
      ${stepsHtml}
    </td>
  </tr>
</table>`;
}

function divider(): string {
  return `<tr><td style="padding: 0 40px;"><div style="border-top: 1px solid #e8e4de; margin: 32px 0;"></div></td></tr>`;
}

export function renderDailyGrindHtml(
  content: DailyGrindContent,
  inputs: RenderInputs,
): { html: string; text: string; subject: string; preheader: string } {
  const sectionLabel = CONTENT_TYPE_LABEL[content.contentType];
  const firstPullParagraphs = content.firstPull.paragraphs
    .map((p) => `<p style="margin: 0 0 14px 0;">${escapeHtml(p)}</p>`)
    .join("\n");

  const worthKnowingItems = content.worthKnowing
    .map((item, i) => renderWorthKnowingItem(item, i === content.worthKnowing.length - 1))
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Daily Grind</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #faf9f7; color: #2d2926; line-height: 1.7; font-size: 16px;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${escapeHtml(content.preheader)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf9f7;">
    <tr>
      <td align="center" style="padding: 20px 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #ffffff;">

          <!-- HEADER -->
          <tr>
            <td style="background-color: #ffffff; padding: 28px 40px; border-bottom: 3px solid #c4a882;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td>
                    <span style="font-size: 24px;">☕</span>
                    <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 22px; font-weight: 700; color: #2d2926; vertical-align: middle; margin-left: 10px;">The Daily Grind</span>
                  </td>
                  <td align="right" style="color: #9a8b7a; font-size: 13px; font-weight: 500;">${escapeHtml(inputs.issueDate)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- OPENING TRIFECTA -->
          <tr>
            <td style="padding: 24px 40px 0 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border: 1px solid #e8e4de;">
                ${renderTheNumber(content.openingTrifecta.theNumber)}
                ${renderTheUnspoken(content.openingTrifecta.theUnspoken)}
                ${renderTheFlip(content.openingTrifecta.theFlip)}
              </table>
            </td>
          </tr>

          <!-- FIRST PULL -->
          <tr>
            <td style="padding: 36px 40px 0 40px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 14px 0;">First Pull</p>
              <h1 style="font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 700; color: #2d2926; line-height: 1.25; margin: 0 0 24px 0;">${escapeHtml(content.headline)}</h1>
              ${firstPullParagraphs}
            </td>
          </tr>

          ${divider()}

          <!-- WORTH KNOWING -->
          <tr>
            <td style="padding: 0 40px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 6px 0;">Worth Knowing</p>
              <p style="font-size: 13px; color: #9a8b7a; font-style: italic; margin: 0 0 20px 0;">Industry news. Sharp takes.</p>
              ${worthKnowingItems}
            </td>
          </tr>

          ${divider()}

          <!-- SPONSOR -->
          <tr>
            <td style="padding: 0 40px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 16px 0;">A Word From Our Sponsor</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border: 1px solid #e8e4de; border-radius: 8px;">
                <tr>
                  <td style="padding: 24px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td style="width: 80px; vertical-align: top; padding-right: 20px;">
                          <img src="https://cdn.prod.website-files.com/62e057b9f7203c5b6fdf1a48/62e81abb175ad2b73e18ecdf_Castor-Abbott-Logo-Diamond-Webclip.jpg" alt="Castor Abbott" width="80" style="display: block; width: 80px; height: 80px; border-radius: 8px;">
                        </td>
                        <td style="vertical-align: top;">
                          <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #2d2926; margin: 0 0 12px 0;">Industry average: $5M. Our clients: $23M.</p>
                          <p style="color: #4a4540; font-size: 15px; margin: 0 0 16px 0;">Same effort. Different quality of prospect. We deliver appointments with investors averaging $2.36M in investable assets, looking for a good advisor.</p>
                          <p style="margin: 0;"><a href="https://go.oncehub.com/CastorAbbottTeam" style="color: #c4a882; text-decoration: none; font-size: 15px; font-weight: 600;">See if you qualify &rarr;</a></p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${divider()}

          <!-- MAIN CONTENT (Tactic / Take / Story / Rant / Special) -->
          <tr>
            <td style="padding: 0 40px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 14px 0;">${escapeHtml(sectionLabel)}</p>
              <h2 style="font-family: Georgia, 'Times New Roman', serif; font-size: 20px; font-weight: 700; color: #2d2926; margin: 0 0 12px 0;">${escapeHtml(content.mainContent.subhead)}</h2>
              <p style="color: #4a4540; margin: 0 0 18px 0;">${escapeHtml(content.mainContent.intro)}</p>
              ${renderHowToBox(content.mainContent.howTo)}
              <p style="color: #4a4540; margin: 0 0 18px 0;">${escapeHtml(content.mainContent.closing)}</p>
            </td>
          </tr>

          ${divider()}

          <!-- GROUNDS FOR THOUGHT -->
          <tr>
            <td style="padding: 0 40px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 14px 0;">Grounds for Thought</p>
              <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 17px; font-style: italic; color: #4a4540; text-align: center; padding: 20px 0; margin: 0;">${escapeHtml(content.groundsForThought)}</p>
            </td>
          </tr>

          ${divider()}

          <!-- ANCIENT TRUTH -->
          <tr>
            <td style="padding: 0 40px;">
              <p style="font-size: 12px; font-weight: 700; color: #c4a882; text-transform: uppercase; letter-spacing: 2px; margin: 0 0 14px 0;">Ancient Truth</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #faf8f5; border-top: 1px solid #e8e4de; border-bottom: 1px solid #e8e4de;">
                <tr>
                  <td style="padding: 24px; text-align: center;">
                    <p style="font-family: Georgia, 'Times New Roman', serif; font-size: 16px; font-style: italic; color: #2d2926; margin: 0 0 8px 0;">"${escapeHtml(content.ancientTruth.verse)}"</p>
                    <p style="font-size: 13px; color: #9a8b7a; margin: 0 0 12px 0;">${escapeHtml(content.ancientTruth.reference)}</p>
                    <p style="font-size: 14px; color: #6b6560; margin: 0;">${escapeHtml(content.ancientTruth.application)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- SIGN OFF -->
          <tr>
            <td style="padding: 36px 40px 20px 40px;">
              <p style="margin: 0 0 4px 0; font-size: 16px; line-height: 1.7; color: #4a4540;">Keep grinding,</p>
              <p style="margin: 0; font-family: Georgia, 'Times New Roman', serif; font-size: 18px; font-weight: 700; color: #2d2926;">Mark ☕</p>
            </td>
          </tr>

          <!-- P.S. -->
          <tr>
            <td style="padding: 0 40px 44px 40px;">
              <p style="font-size: 14px; color: #6b6560; margin: 0;"><strong style="color: #4a4540;">P.S.</strong> ${escapeHtml(content.ps)}</p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background-color: #faf8f5; padding: 24px 40px; border-top: 1px solid #e8e4de; text-align: center;">
              <p style="margin: 0 0 12px 0;">
                <a href="${escapeHtml(inputs.webArchiveUrl ?? "https://castorabbott.com/newsletter/grind/")}" style="color: #9a8b7a; text-decoration: none; font-size: 13px; margin: 0 12px;">View in browser</a>
                <a href="${escapeHtml(inputs.unsubscribeUrl)}" style="color: #9a8b7a; text-decoration: none; font-size: 13px; margin: 0 12px;">Unsubscribe</a>
              </p>
              <p style="font-size: 12px; color: #9a8b7a; margin: 0;">The Daily Grind &bull; For advisors who want to grow their practice and live a great life</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = renderText(content, inputs);

  return {
    html,
    text,
    subject: content.headline,
    preheader: content.preheader,
  };
}

function renderText(content: DailyGrindContent, inputs: RenderInputs): string {
  const lines: string[] = [];
  lines.push("THE DAILY GRIND");
  lines.push(inputs.issueDate);
  lines.push("");
  lines.push("=== OPENING TRIFECTA ===");
  lines.push("");
  lines.push(`THE NUMBER: ${content.openingTrifecta.theNumber.stat}`);
  lines.push(content.openingTrifecta.theNumber.description);
  lines.push("");
  lines.push("THE UNSPOKEN");
  lines.push(content.openingTrifecta.theUnspoken);
  lines.push("");
  lines.push("THE FLIP");
  lines.push(`Conventional: "${content.openingTrifecta.theFlip.conventional}"`);
  lines.push(`Reality: ${content.openingTrifecta.theFlip.reality}`);
  lines.push("");
  lines.push("=== FIRST PULL ===");
  lines.push("");
  lines.push(content.headline.toUpperCase());
  lines.push("");
  for (const p of content.firstPull.paragraphs) {
    lines.push(p);
    lines.push("");
  }
  lines.push("=== WORTH KNOWING ===");
  lines.push("");
  for (const item of content.worthKnowing) {
    lines.push(`[${item.category.toUpperCase()}] ${item.headline}`);
    if (item.stat) lines.push(`  ${item.stat} — ${item.statLabel ?? ""}`);
    lines.push(item.body);
    lines.push(`  My take: ${item.myTake}`);
    lines.push("");
  }
  lines.push(`=== ${CONTENT_TYPE_LABEL[content.contentType].toUpperCase()} ===`);
  lines.push("");
  lines.push(content.mainContent.subhead);
  lines.push("");
  lines.push(content.mainContent.intro);
  lines.push("");
  lines.push(content.mainContent.howTo.title);
  for (const s of content.mainContent.howTo.steps) {
    lines.push(`  ${s.label}: ${s.body}`);
  }
  lines.push("");
  lines.push(content.mainContent.closing);
  lines.push("");
  lines.push("=== GROUNDS FOR THOUGHT ===");
  lines.push("");
  lines.push(content.groundsForThought);
  lines.push("");
  lines.push("=== ANCIENT TRUTH ===");
  lines.push("");
  lines.push(`"${content.ancientTruth.verse}"`);
  lines.push(content.ancientTruth.reference);
  lines.push("");
  lines.push(content.ancientTruth.application);
  lines.push("");
  lines.push("Keep grinding,");
  lines.push("Mark");
  lines.push("");
  lines.push(`P.S. ${content.ps}`);
  lines.push("");
  lines.push(`Unsubscribe: ${inputs.unsubscribeUrl}`);
  return lines.join("\n");
}
