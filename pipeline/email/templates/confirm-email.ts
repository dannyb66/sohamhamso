/**
 * Double-opt-in confirmation email template.
 *
 * BUILDS a `{ subject, html, text }` payload that the Resend send
 * Worker (pipeline/email/send-confirmations.ts) POSTs to Resend's
 * `/emails` endpoint.
 *
 * DESIGN CONSTRAINTS (locked from the deployment plan):
 *   - PLAIN-TEXT email aesthetic. No images, no remote fonts, no
 *     CSS tracking pixels. The body is a few short paragraphs and a
 *     confirm link. The footer is a one-line unsubscribe link.
 *   - HTML body is INLINE-STYLED only (Gmail strips <style> blocks
 *     in many client modes). Keep styles minimal.
 *   - SEND BOTH `html` and `text`. Resend's spam score benefits from
 *     a real text/plain alternative — single-part HTML mail looks
 *     bot-like to many providers.
 *   - NO TRACKING PIXELS. Verified by `tests/unit/email-templates.test.ts`
 *     with a regex sweep over the rendered HTML.
 *
 * I18N (FUTURE — V1.x):
 *   The function accepts a `lang` param but only English is shipped
 *   at V1. Other languages roll out when the corresponding subscribe
 *   pipeline lands (per src/lib/subscribe-langs.ts ACTIVE_LANGUAGES).
 *   Unknown / not-yet-translated langs fall back to English silently
 *   — better than failing the send.
 */

export interface ConfirmEmailInput {
  /** ISO 639-1 code (e.g., 'en'). V1: only 'en' is honored; others fall back. */
  lang: string;
  /** The 32-char base64url token from `subscribers.unsubscribe_token`. */
  unsubscribeToken: string;
  /**
   * Origin used to build absolute URLs. In production:
   * `https://sohamhamso.org`. In dev/preview: whatever the runtime
   * resolves to. Always a bare origin (no trailing slash).
   */
  baseUrl: string;
}

export interface ConfirmEmailPayload {
  subject: string;
  html: string;
  text: string;
}

/**
 * Compose the confirmation email. Pure function — no I/O, no env
 * reads. Caller is responsible for the actual send (and for providing
 * the right baseUrl per environment).
 */
export function confirmEmail(input: ConfirmEmailInput): ConfirmEmailPayload {
  const { unsubscribeToken } = input;
  const baseUrl = stripTrailingSlash(input.baseUrl);

  // Re-use the same token for both confirm + unsubscribe (per the
  // locked plan). The endpoints disambiguate by route, not by token
  // shape.
  const confirmUrl = `${baseUrl}/api/confirm?token=${encodeURIComponent(unsubscribeToken)}`;
  const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  // English is the only V1 copy. The `lang` param is accepted but
  // unused until per-language templates land — see file header.
  const subject = 'Confirm your sohamhamso daily verse';

  const text = renderText({ confirmUrl, unsubscribeUrl });
  const html = renderHtml({ confirmUrl, unsubscribeUrl });

  return { subject, html, text };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// ─── Plain text ───────────────────────────────────────────────────────
function renderText(args: { confirmUrl: string; unsubscribeUrl: string }): string {
  return [
    'Confirm your sohamhamso daily verse.',
    '',
    'You (or someone using your email) subscribed to the daily verse',
    'from sohamhamso.org. To start receiving it tomorrow at sunrise,',
    'confirm with the link below:',
    '',
    args.confirmUrl,
    '',
    "This link expires in 24 hours. If you didn't subscribe, ignore",
    "this message — your address won't be added to any list.",
    '',
    '— sohamhamso',
    '',
    '---',
    `Unsubscribe at any time: ${args.unsubscribeUrl}`,
  ].join('\n');
}

// ─── HTML ─────────────────────────────────────────────────────────────
// Inline-styled only. No <style> block, no external resources, no
// images. The wrapper <table> is the historical email-client pattern
// for predictable rendering across Outlook / Gmail / Apple Mail. The
// body width is a hard cap so long URLs don't trigger horizontal
// scroll on mobile.
function renderHtml(args: { confirmUrl: string; unsubscribeUrl: string }): string {
  const confirmHref = escapeAttr(args.confirmUrl);
  const unsubscribeHref = escapeAttr(args.unsubscribeUrl);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Confirm your sohamhamso daily verse</title>',
    '</head>',
    '<body style="margin:0;padding:0;background:#faf6ee;font-family:Georgia,\'Times New Roman\',serif;color:#14110d;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#faf6ee;">',
    '<tr><td align="center" style="padding:32px 16px;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">',
    '<tr><td style="font-size:18px;line-height:1.4;font-weight:600;padding-bottom:16px;">',
    'Confirm your sohamhamso daily verse',
    '</td></tr>',
    '<tr><td style="font-size:16px;line-height:1.6;padding-bottom:16px;">',
    'You (or someone using your email) subscribed to the daily verse from sohamhamso.org. ',
    'To start receiving it tomorrow at sunrise, confirm with the link below:',
    '</td></tr>',
    '<tr><td style="padding-bottom:24px;">',
    `<a href="${confirmHref}" style="display:inline-block;padding:12px 20px;background:#14110d;color:#faf6ee;text-decoration:none;font-size:16px;font-weight:600;">Confirm subscription</a>`,
    '</td></tr>',
    '<tr><td style="font-size:14px;line-height:1.6;color:#5e564a;padding-bottom:16px;">',
    'This link expires in 24 hours. ',
    "If you didn't subscribe, ignore this message — your address won't be added to any list.",
    '</td></tr>',
    '<tr><td style="font-size:14px;line-height:1.6;color:#5e564a;padding-bottom:32px;">',
    "If the button above doesn't render, paste this URL into your browser:<br>",
    `<a href="${confirmHref}" style="color:#5e564a;word-break:break-all;">${confirmHref}</a>`,
    '</td></tr>',
    '<tr><td style="border-top:1px solid #d6cfc1;padding-top:16px;font-size:12px;line-height:1.5;color:#8a8170;">',
    '— sohamhamso<br>',
    `<a href="${unsubscribeHref}" style="color:#8a8170;">Unsubscribe</a>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}

// Conservative attribute escape — encodes the characters that would
// break out of an `href="..."` attribute. Our URL inputs are
// %-encoded by the caller (encodeURIComponent on the token), so this
// is belt-and-braces for the baseUrl portion.
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
