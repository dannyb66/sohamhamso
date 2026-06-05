import { describe, expect, it } from 'vitest';
import { xmlEscape } from '../../../src/lib/seo/xml-escape';

describe('xmlEscape — adversarial inputs', () => {
  it('escapes ampersand', () => {
    expect(xmlEscape('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes less-than and greater-than', () => {
    expect(xmlEscape('a < b > c')).toBe('a &lt; b &gt; c');
  });

  it('escapes single quote (apos)', () => {
    expect(xmlEscape("o'connor")).toBe('o&apos;connor');
  });

  it('escapes double quote (quot)', () => {
    expect(xmlEscape('he said "yes"')).toBe('he said &quot;yes&quot;');
  });

  it('handles all five entities together', () => {
    expect(xmlEscape(`<a href="foo&bar">o'</a>`)).toBe(
      '&lt;a href=&quot;foo&amp;bar&quot;&gt;o&apos;&lt;/a&gt;',
    );
  });

  it('handles empty string', () => {
    expect(xmlEscape('')).toBe('');
  });

  it('passes through ASCII without entities unchanged', () => {
    expect(xmlEscape('plain ascii text 123')).toBe('plain ascii text 123');
  });

  it('passes through unicode characters unchanged (Devanagari)', () => {
    expect(xmlEscape('शिवसूत्राणि चैतन्यमात्मा')).toBe('शिवसूत्राणि चैतन्यमात्मा');
  });

  it('passes through emoji and high-BMP unicode unchanged', () => {
    expect(xmlEscape('🕉️ ॐ नमः शिवाय 🪷')).toBe('🕉️ ॐ नमः शिवाय 🪷');
  });

  it('escapes ampersand before other entities (order matters)', () => {
    // If `&` were escaped LAST, `<` → `&lt;` then `&` → `&amp;` would double-escape
    // to `&amp;lt;`. This guards against a regression in replacement ordering.
    expect(xmlEscape('<')).toBe('&lt;');
    expect(xmlEscape('&<')).toBe('&amp;&lt;');
  });

  it('double-escapes already-escaped entities (documented behavior, NOT idempotent)', () => {
    // Deliberate trap: callers must not call xmlEscape twice on the same string.
    // The function is intentionally not entity-aware.
    expect(xmlEscape('&amp;')).toBe('&amp;amp;');
    expect(xmlEscape('&lt;')).toBe('&amp;lt;');
  });

  it('escapes long runs of special characters', () => {
    const input = '&&&<<<>>>"""\'\'\'';
    const expected =
      '&amp;&amp;&amp;&lt;&lt;&lt;&gt;&gt;&gt;&quot;&quot;&quot;&apos;&apos;&apos;';
    expect(xmlEscape(input)).toBe(expected);
  });

  it('preserves whitespace (spaces, tabs, newlines)', () => {
    expect(xmlEscape('a\tb\nc d')).toBe('a\tb\nc d');
  });

  it('passes through C0 control chars without altering them (documents current behavior)', () => {
    // XML 1.0 spec rejects most C0 control chars (U+0001..U+001F except \t \n \r)
    // in well-formed documents. The current xmlEscape does NOT strip them — this test
    // documents that gap so a future stripping fix is a deliberate, tested change.
    const input = 'helloworld';
    expect(xmlEscape(input)).toBe(input);
  });
});

describe('xmlEscape — sitemap <loc> regression guards', () => {
  it('escaped output contains no raw ampersand outside an entity', () => {
    // Regression guard: a raw `&` in a <loc> breaks XML parsers silently.
    const dangerous = `query?a=1&b=2&c=3`;
    const escaped = xmlEscape(dangerous);
    // After escape, every `&` MUST be followed by a known entity name + `;`
    expect(escaped).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
    expect(escaped).toBe('query?a=1&amp;b=2&amp;c=3');
  });

  it('escaped output contains no raw < or >', () => {
    const dangerous = `<script>alert('xss')</script>`;
    const escaped = xmlEscape(dangerous);
    expect(escaped).not.toMatch(/[<>]/);
  });

  it('escaped output is safely wrappable in <loc>...</loc>', () => {
    const dangerous = `https://example.com/path?q=a&b="c"&d='e'<f>`;
    const escaped = xmlEscape(dangerous);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>${escaped}</loc></url></urlset>`;
    // No raw structural characters inside the <loc> body
    const locBody = xml.match(/<loc>([\s\S]*?)<\/loc>/)?.[1] ?? '';
    expect(locBody).not.toMatch(/[<>]/);
    expect(locBody).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
  });
});
