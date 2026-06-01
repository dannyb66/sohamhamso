// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Unit tests for `src/pages/api/subscribe.ts` POST handler.
 *
 * Strategy:
 *   - Open an in-memory SQLite DB and apply the production schema.
 *   - Inject it as the writable singleton via `__setWritableDbForTests`.
 *   - Build a stub `APIContext` with a real `Request` carrying a JSON body.
 *   - Call `POST({ request })` and assert on the Response status + JSON body
 *     + the row that landed in the in-memory `subscribers` table.
 *
 * No network. No Astro runtime. Pure-function shape: (ctx) → Response.
 *
 * Run with: `bun --bun vitest run tests/unit/api-subscribe.test.ts`
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { __setWritableDbForTests } from '../../src/lib/db';
import { POST, hashEmail, regionForRequest } from '../../src/pages/api/subscribe';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

let db: Database;

beforeAll(() => {
  // Pin a deterministic pepper so determinism assertions are stable.
  process.env.SUBSCRIBER_HASH_PEPPER = 'test-pepper-A';

  db = new Database(':memory:');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  __setWritableDbForTests(db);
});

afterAll(() => {
  __setWritableDbForTests(null);
  db.close();
});

beforeEach(() => {
  // Each test starts with an empty subscribers table so idempotency
  // and uniqueness assertions are independent.
  db.exec('DELETE FROM subscribers;');
});

function jsonReq(body: unknown, extraHeaders?: Record<string, string>): Request {
  return new Request('http://localhost/api/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
    body: JSON.stringify(body),
  });
}

// Astro's APIContext is rich; the handler only reads `request`. Cast through
// `unknown` so we don't have to construct the rest of the context shape.
function call(req: Request): Promise<Response> {
  return Promise.resolve(POST({ request: req } as unknown as Parameters<typeof POST>[0]));
}

type SubscriberRow = {
  id: number;
  email_hash: string;
  language: string;
  subscribed_at: string;
  unsubscribe_token: string;
  region: 'us' | 'eu';
  confirmed: number;
  confirmed_at: string | null;
};

function allSubscribers(): SubscriberRow[] {
  return db.query<SubscriberRow, []>('SELECT * FROM subscribers').all();
}

describe('POST /api/subscribe — validation', () => {
  it('returns 200 + ok:true for a valid email + default language', async () => {
    const res = await call(jsonReq({ email: 'danny@example.com' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/inbox/i);
    expect(body.message).toMatch(/confirm/i);
  });

  it("returns 200 + ok:true when language is explicitly 'en'", async () => {
    const res = await call(jsonReq({ email: 'danny@example.com', language: 'en' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 400 + helpful message when email is missing', async () => {
    const res = await call(jsonReq({}));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toBe('Please enter a valid email address.');
  });

  it('returns 400 + helpful message when email is empty string', async () => {
    const res = await call(jsonReq({ email: '' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/valid email/i);
  });

  it('returns 400 for a malformed email (no @)', async () => {
    const res = await call(jsonReq({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/valid email/i);
  });

  it('returns 400 for a malformed email (no TLD)', async () => {
    const res = await call(jsonReq({ email: 'danny@localhost' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it('returns 400 for an unknown language code', async () => {
    const res = await call(jsonReq({ email: 'danny@example.com', language: 'klingon' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/unknown language/i);
  });

  it("returns 400 for a known-but-inactive language (e.g., 'hi') with the V1 message", async () => {
    const res = await call(jsonReq({ email: 'danny@example.com', language: 'hi' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/yet|english|roll out/i);
  });

  it('returns Content-Type application/json', async () => {
    const res = await call(jsonReq({ email: 'danny@example.com' }));
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  });

  it('does NOT insert a row on validation failure', async () => {
    await call(jsonReq({ email: 'not-an-email' }));
    expect(allSubscribers()).toHaveLength(0);
  });

  it('accepts form-encoded bodies (no-JS fallback path)', async () => {
    const form = new URLSearchParams({ email: 'danny@example.com', language: 'en' });
    const req = new Request('http://localhost/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const res = await call(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    expect(allSubscribers()).toHaveLength(1);
  });
});

describe('POST /api/subscribe — persistence', () => {
  it('inserts a row with email_hash, language, region, token, subscribed_at', async () => {
    const res = await call(jsonReq({ email: 'danny@example.com', language: 'en' }));
    expect(res.status).toBe(200);
    const rows = allSubscribers();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.email_hash).toHaveLength(64); // SHA-256 hex
    expect(r.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.language).toBe('en');
    expect(r.region).toBe('us');
    // 32-char base64url token (24 random bytes, no padding).
    expect(r.unsubscribe_token).toHaveLength(32);
    expect(r.unsubscribe_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(r.subscribed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.confirmed).toBe(0);
    expect(r.confirmed_at).toBeNull();
  });

  it('is idempotent on (email_hash, language): second subscribe returns 200, same row count', async () => {
    const first = await call(jsonReq({ email: 'danny@example.com', language: 'en' }));
    expect(first.status).toBe(200);
    const second = await call(jsonReq({ email: 'danny@example.com', language: 'en' }));
    expect(second.status).toBe(200);
    const body = (await second.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/inbox/i);
    // Still exactly one row — re-subscribe absorbed.
    expect(allSubscribers()).toHaveLength(1);
  });

  it('treats email case + whitespace as the same subscriber', async () => {
    await call(jsonReq({ email: 'danny@example.com', language: 'en' }));
    await call(jsonReq({ email: '  DANNY@example.com  ', language: 'en' }));
    expect(allSubscribers()).toHaveLength(1);
  });

  it("derives region 'us' by default when no cf-ipcountry header is present", async () => {
    await call(jsonReq({ email: 'no-header@example.com' }));
    expect(allSubscribers()[0].region).toBe('us');
  });

  it("derives region 'eu' when cf-ipcountry is an EU country code (DE)", async () => {
    await call(jsonReq({ email: 'berlin@example.com' }, { 'cf-ipcountry': 'DE' }));
    expect(allSubscribers()[0].region).toBe('eu');
  });

  it("derives region 'us' for non-EU country codes (e.g., GB — post-Brexit)", async () => {
    await call(jsonReq({ email: 'london@example.com' }, { 'cf-ipcountry': 'GB' }));
    expect(allSubscribers()[0].region).toBe('us');
  });
});

describe('hashEmail() determinism', () => {
  it('is deterministic for the same email + pepper', () => {
    const a = hashEmail('danny@example.com', 'pepper-A');
    const b = hashEmail('danny@example.com', 'pepper-A');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('differs across two different peppers for the same email', () => {
    const a = hashEmail('danny@example.com', 'pepper-A');
    const b = hashEmail('danny@example.com', 'pepper-B');
    expect(a).not.toBe(b);
  });

  it('collapses casing + whitespace before hashing', () => {
    const a = hashEmail('danny@example.com', 'pepper-A');
    const b = hashEmail('  DANNY@Example.COM  ', 'pepper-A');
    expect(a).toBe(b);
  });
});

describe('regionForRequest()', () => {
  it("returns 'us' when no header is set", () => {
    const h = new Headers();
    expect(regionForRequest(h)).toBe('us');
  });

  it("returns 'eu' for an EU country code", () => {
    const h = new Headers({ 'cf-ipcountry': 'FR' });
    expect(regionForRequest(h)).toBe('eu');
  });

  it("returns 'us' for a non-EU country code", () => {
    const h = new Headers({ 'cf-ipcountry': 'IN' });
    expect(regionForRequest(h)).toBe('us');
  });

  it('handles lowercase header values', () => {
    const h = new Headers({ 'cf-ipcountry': 'de' });
    expect(regionForRequest(h)).toBe('eu');
  });

  it("returns 'us' for the Cloudflare unknown-country sentinel 'XX'", () => {
    const h = new Headers({ 'cf-ipcountry': 'XX' });
    expect(regionForRequest(h)).toBe('us');
  });
});
