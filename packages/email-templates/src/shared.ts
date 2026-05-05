/**
 * HTML escape — covers the four characters that matter for content
 * embedded in HTML body context. Attribute values are quoted so the
 * same set works there too.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap rendered body content in a layout shell with reset CSS, brand
 * header, and CAN-SPAM-compliant footer. Email clients have inconsistent
 * CSS support so the shell uses inline styles + tables for layout.
 */
export function wrap(opts: {
  brandName: string;
  preheader: string;
  body: string;
  unsubscribeUrl: string;
  webArchiveUrl?: string | undefined;
}): string {
  const archiveLink = opts.webArchiveUrl
    ? `<a href="${escapeHtml(opts.webArchiveUrl)}" style="color:#7dd3fc;text-decoration:underline">view in browser</a> · `
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(opts.brandName)}</title>
</head>
<body style="margin:0;padding:0;background:#f8f8f6;font-family:Georgia,'Times New Roman',serif;color:#111;">
  <span style="display:none!important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(opts.preheader)}</span>
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#f8f8f6">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e5e0;border-radius:4px;">
          <tr>
            <td style="padding:32px 40px 16px;border-bottom:1px solid #e5e5e0;">
              <h1 style="margin:0;font-size:18px;font-weight:600;letter-spacing:.02em;color:#111;">${escapeHtml(opts.brandName)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;font-size:16px;line-height:1.6;color:#222;">
              ${opts.body}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px;border-top:1px solid #e5e5e0;font-size:12px;color:#888;line-height:1.5;text-align:center;">
              ${archiveLink}<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:#7dd3fc;text-decoration:underline">unsubscribe</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Append section-attribution tracking params to a URL. Used by section
 * link rewriting in the rendered HTML so click events can be attributed
 * back to the section that produced the click.
 */
export function withTracking(
  url: string,
  params: Record<string, string> | undefined,
  section: string,
): string {
  if (!params) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    u.searchParams.set("section", section);
    return u.toString();
  } catch {
    return url;
  }
}
