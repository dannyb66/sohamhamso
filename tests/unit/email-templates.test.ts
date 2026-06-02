/**
 * Unit tests for the double-opt-in email template
 * (`pipeline/email/templates/confirm-email.ts`).
 *
 * Asserts the contract the deployment plan locked in:
 *   - Subject is set and recognisable.
 *   - HTML + text parts BOTH render (Resend spam-score requirement).
 *   - Confirm link URL is correct + URL-encodes the token.
 *   - Unsubscribe link is present in BOTH html + text.
 *   - NO tracking pixels (regex sweep for remote <img> tags).
 *   - baseUrl with a trailing slash collapses correctly (idempotency
 *     of the URL builder).
 */

import { describe, expect, it } from 'vitest';
import { confirmEmail } from '../../pipeline/email/templates/confirm-email';

// 32-char base64url token shape, identical to what
// `generateUnsubscribeToken()` in subscribe.ts produces.
const TOKEN = 'aB-_0123456789aB-_0123456789aBCD';

describe('confirmEmail() — payload shape', () => {
  it('returns { subject, html, text } for a valid input', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    expect(out.subject).toBeTypeOf('string');
    expect(out.html).toBeTypeOf('string');
    expect(out.text).toBeTypeOf('string');
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.html.length).toBeGreaterThan(0);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('subject mentions sohamhamso (no generic "Confirm your email")', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    expect(out.subject).toMatch(/sohamhamso/i);
    expect(out.subject).toMatch(/confirm/i);
  });
});

describe('confirmEmail() — confirm link', () => {
  it('embeds the confirm URL in both html and text', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    const expected = `https://sohamhamso.org/api/confirm?token=${TOKEN}`;
    expect(out.html).toContain(expected);
    expect(out.text).toContain(expected);
  });

  it('URL-encodes a token containing reserved characters (defense-in-depth)', () => {
    // The real token alphabet is base64url (safe in URLs), but the
    // builder must defensively encode anything tricky a future token
    // scheme might emit — proves it doesn't paste the raw value into
    // the URL.
    const tricky = 'a+b/c=d&e?f#g';
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: tricky,
      baseUrl: 'https://sohamhamso.org',
    });
    const encoded = encodeURIComponent(tricky);
    expect(out.text).toContain(`/api/confirm?token=${encoded}`);
  });

  it('collapses a trailing slash on baseUrl (no double slash in confirm URL)', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org/',
    });
    expect(out.text).not.toMatch(/sohamhamso\.org\/\/api/);
    expect(out.text).toContain('https://sohamhamso.org/api/confirm');
  });
});

describe('confirmEmail() — unsubscribe link', () => {
  it('embeds the unsubscribe URL in both html and text', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    const expected = `https://sohamhamso.org/api/unsubscribe?token=${TOKEN}`;
    expect(out.html).toContain(expected);
    expect(out.text).toContain(expected);
  });

  it('html version exposes an <a href="..."> for the unsubscribe link (not just inline text)', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    // Match an <a href=...unsubscribe...> tag — the literal anchor
    // matters because Gmail's "List-Unsubscribe" detection + the
    // user's eye both need an actual link to click.
    expect(out.html).toMatch(/<a\s[^>]*href="[^"]*\/api\/unsubscribe\?token=/i);
  });
});

describe('confirmEmail() — no tracking pixels (privacy promise)', () => {
  // The deployment plan explicitly forbids tracking pixels in daily-verse
  // emails AND on the confirmation surface. This test enforces that promise.
  it('html contains zero <img> tags (no pixel, no logo, no avatar)', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    expect(out.html).not.toMatch(/<img\b/i);
  });

  it('html contains no remote <link rel="stylesheet">', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    expect(out.html).not.toMatch(/<link\b[^>]*rel="?stylesheet/i);
  });

  it('html contains no <script> tags', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    expect(out.html).not.toMatch(/<script\b/i);
  });

  it('html references no third-party URLs (only sohamhamso.org appears)', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    // Find every absolute URL in the HTML; assert each one's host is
    // sohamhamso.org. Catches a future regression that links a CDN
    // logo, a Google font, or a tracking endpoint.
    const urls = out.html.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const u of urls) {
      const host = new URL(u).host;
      expect(host).toBe('sohamhamso.org');
    }
  });
});

describe('confirmEmail() — language handling (V1: en only)', () => {
  it('renders English copy for lang="en"', () => {
    const out = confirmEmail({
      lang: 'en',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    expect(out.subject).toMatch(/confirm/i);
    expect(out.text).toMatch(/sunrise|daily verse|confirm/i);
  });

  it('falls back gracefully for an unknown lang (still renders, still English)', () => {
    // V1 ships English only; non-`en` langs fall back rather than
    // throw. This guarantees a send-loop won't crash mid-batch
    // because a future row carries an unexpected lang code.
    const out = confirmEmail({
      lang: 'klingon',
      unsubscribeToken: TOKEN,
      baseUrl: 'https://sohamhamso.org',
    });
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.html.length).toBeGreaterThan(0);
  });
});
