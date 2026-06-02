/**
 * Unit tests for `src/pages/api/confirm.ts` GET handler.
 *
 * Strategy mirrors `tests/unit/api-subscribe.test.ts`:
 *   - Build a fake `SubscriberConfirm` impl with explicit, observable
 *     state (a `Map<token, { confirmed: boolean }>`).
 *   - Inject it via `__setSubscriberConfirmForTests`.
 *   - Construct a real `Request`, hand-build the minimal Astro
 *     `APIContext` shape the handler reads (just `url`).
 *   - Assert on the Response status + Location header + the fake
 *     impl's recorded state.
 *
 * No DB, no network, no Astro runtime. Pure-function shape.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type SubscriberConfirm,
  __setSubscriberConfirmForTests,
} from '../../src/lib/subscriber-confirm';
import { GET } from '../../src/pages/api/confirm';

// ─── Fake impl ───────────────────────────────────────────────────────
function makeFake(initialRows: Array<{ token: string; confirmed?: boolean }> = []): {
  impl: SubscriberConfirm;
  state: Map<string, { confirmed: boolean }>;
} {
  const state = new Map<string, { confirmed: boolean }>();
  for (const r of initialRows) {
    state.set(r.token, { confirmed: !!r.confirmed });
  }
  return {
    state,
    impl: {
      async confirmByToken(token) {
        const row = state.get(token);
        if (!row) return { status: 'unknown' };
        row.confirmed = true;
        return { status: 'confirmed' };
      },
      async deleteByToken(token) {
        const had = state.delete(token);
        return { deleted: had };
      },
    },
  };
}

// Astro's APIContext is rich; the GET handler only reads `url`. Cast
// through `unknown` so we don't have to construct the rest.
function call(urlString: string): Promise<Response> {
  const u = new URL(urlString);
  return Promise.resolve(
    GET({
      url: u,
      request: new Request(urlString),
    } as unknown as Parameters<typeof GET>[0]),
  );
}

// A valid 32-char base64url token matches the shape produced by
// `generateUnsubscribeToken()` in subscribe.ts.
const VALID_TOKEN = 'A'.repeat(32);
const VALID_TOKEN_2 = 'B-_aZ09xY'.padEnd(32, 'C');

beforeEach(() => {
  // Each test installs its own fake — clear any prior state.
  __setSubscriberConfirmForTests(null);
});

afterEach(() => {
  __setSubscriberConfirmForTests(null);
});

describe('GET /api/confirm — happy path', () => {
  it('redirects to /confirmed and marks the row as confirmed for a valid token', async () => {
    const fake = makeFake([{ token: VALID_TOKEN, confirmed: false }]);
    __setSubscriberConfirmForTests(fake.impl);

    const res = await call(`http://localhost/api/confirm?token=${VALID_TOKEN}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/confirmed');
    expect(fake.state.get(VALID_TOKEN)?.confirmed).toBe(true);
  });

  it('returns a no-store Cache-Control (token must not be cached)', async () => {
    const fake = makeFake([{ token: VALID_TOKEN, confirmed: false }]);
    __setSubscriberConfirmForTests(fake.impl);

    const res = await call(`http://localhost/api/confirm?token=${VALID_TOKEN}`);

    expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/i);
  });

  it('is idempotent — re-confirming an already-confirmed token still redirects to /confirmed', async () => {
    const fake = makeFake([{ token: VALID_TOKEN, confirmed: true }]);
    __setSubscriberConfirmForTests(fake.impl);

    const res = await call(`http://localhost/api/confirm?token=${VALID_TOKEN}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/confirmed');
    // No `?error=` — the user sees the celebratory page either way.
    expect(res.headers.get('location')).not.toMatch(/error/);
  });
});

describe('GET /api/confirm — enumeration defense', () => {
  it('redirects to /confirmed?error=unknown for a token shape-valid but unknown to the DB', async () => {
    const fake = makeFake([]); // empty DB
    __setSubscriberConfirmForTests(fake.impl);

    const res = await call(`http://localhost/api/confirm?token=${VALID_TOKEN_2}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/confirmed?error=unknown');
  });

  it('redirects to /confirmed?error=unknown for a missing token (no 404)', async () => {
    const fake = makeFake([]);
    __setSubscriberConfirmForTests(fake.impl);

    const res = await call('http://localhost/api/confirm');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/confirmed?error=unknown');
  });

  it('redirects to /confirmed?error=unknown for a malformed token (no 404)', async () => {
    const fake = makeFake([]);
    __setSubscriberConfirmForTests(fake.impl);

    // 5 chars — far too short to match the 32-char base64url shape.
    const res = await call('http://localhost/api/confirm?token=short');

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/confirmed?error=unknown');
  });

  it('redirects to /confirmed?error=unknown for a token with non-base64url chars', async () => {
    const fake = makeFake([]);
    __setSubscriberConfirmForTests(fake.impl);

    // 32 chars but `!` is not in the base64url alphabet.
    const bad = '!'.repeat(32);
    const res = await call(`http://localhost/api/confirm?token=${encodeURIComponent(bad)}`);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/confirmed?error=unknown');
  });

  it('does NOT touch the DB for a malformed token (cheapest enumeration defense)', async () => {
    let dbCalls = 0;
    const impl: SubscriberConfirm = {
      async confirmByToken() {
        dbCalls++;
        return { status: 'unknown' };
      },
      async deleteByToken() {
        dbCalls++;
        return { deleted: false };
      },
    };
    __setSubscriberConfirmForTests(impl);

    await call('http://localhost/api/confirm?token=short');
    expect(dbCalls).toBe(0);
  });
});

describe('GET /api/confirm — server failure mode', () => {
  it('redirects to /confirmed?error=server when the DB throws', async () => {
    const impl: SubscriberConfirm = {
      async confirmByToken() {
        throw new Error('libsql connection failed');
      },
      async deleteByToken() {
        return { deleted: false };
      },
    };
    __setSubscriberConfirmForTests(impl);

    const res = await call(`http://localhost/api/confirm?token=${VALID_TOKEN}`);

    expect(res.status).toBe(302);
    // Same enumeration-defense pattern — error is logged, user gets a
    // soft redirect, not a 500 with a stack trace.
    expect(res.headers.get('location')).toBe('/confirmed?error=server');
  });
});
