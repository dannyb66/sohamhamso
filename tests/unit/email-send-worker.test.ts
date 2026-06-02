/**
 * Unit tests for the email send Worker
 * (`pipeline/email/send-confirmations.ts`).
 *
 * Asserts the contract that makes dev cheap:
 *   - Missing RESEND_API_KEY → clean no-op (no throw, no fetch, no DB).
 *   - Missing RESEND_FROM → same.
 *   - Missing TURSO env → same.
 *
 * The full send path (fetch mocking, libsql mocking, status-code
 * branching) is not exercised here — keeping this file scoped to the
 * "deploy is safe even before secrets land" contract that the
 * deployment plan called out.
 */

import { describe, expect, it, vi } from 'vitest';
import { sendPendingConfirmations } from '../../pipeline/email/send-confirmations';

describe('sendPendingConfirmations() — no-op behavior', () => {
  it('returns a zero-summary when RESEND_API_KEY is unset (dev no-op)', async () => {
    const fetchSpy = vi.fn();
    const summary = await sendPendingConfirmations({
      env: {},
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(summary.attempted).toBe(0);
    expect(summary.sent).toBe(0);
    // Critically: we never hit Resend.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a zero-summary when RESEND_FROM is unset', async () => {
    const fetchSpy = vi.fn();
    const summary = await sendPendingConfirmations({
      env: { RESEND_API_KEY: 'rk_test' },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(summary).toEqual({
      attempted: 0,
      sent: 0,
      permanent_failures: 0,
      transient_failures: 0,
      skipped: 0,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns a zero-summary when TURSO env is unset', async () => {
    const fetchSpy = vi.fn();
    const summary = await sendPendingConfirmations({
      env: { RESEND_API_KEY: 'rk_test', RESEND_FROM: 'sender@example.org' },
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
    expect(summary.attempted).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not throw when called with an entirely empty env (smoke test for CI)', async () => {
    await expect(sendPendingConfirmations({ env: {} })).resolves.toBeDefined();
  });
});

describe('sendPendingConfirmations() — happy path with injected DB + fetch', () => {
  it('sends one row, marks it sent, and returns sent=1', async () => {
    // Fake libsql client surface.
    const executed: Array<{ sql: string; args?: unknown[] }> = [];
    const client = {
      async execute(arg: string | { sql: string; args?: unknown[] }) {
        if (typeof arg === 'string') {
          executed.push({ sql: arg });
          // ALTER statements during cold-start — return empty rowset.
          return { rows: [] };
        }
        executed.push(arg);
        if (/^SELECT/i.test(arg.sql)) {
          return {
            rows: [
              {
                id: 1,
                language: 'en',
                unsubscribe_token: 'A'.repeat(32),
                pending_email_plaintext: 'danny@example.com',
              },
            ],
          };
        }
        // UPDATE statements.
        return { rows: [], rowsAffected: 1 };
      },
    };

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'resend-msg-id-123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const summary = await sendPendingConfirmations({
      env: {
        RESEND_API_KEY: 'rk_test',
        RESEND_FROM: 'sohamhamso <hello@sohamhamso.org>',
        TURSO_PII_URL: 'libsql://example.turso.io',
        TURSO_PII_AUTH_TOKEN: 'tk_test',
        PUBLIC_BASE_URL: 'https://sohamhamso.org',
      },
      client,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(summary.attempted).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.permanent_failures).toBe(0);
    expect(summary.transient_failures).toBe(0);

    // Fetch was called once, to the Resend endpoint, with Bearer auth.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer rk_test');

    // An UPDATE setting email_sent_at landed.
    const updates = executed.filter(
      (e) => typeof e.sql === 'string' && /UPDATE subscribers/i.test(e.sql),
    );
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.some((u) => /email_sent_at\s*=/i.test(u.sql))).toBe(true);
  });

  it('classifies a 400 from Resend as a permanent failure and marks the row failed', async () => {
    const executed: Array<{ sql: string; args?: unknown[] }> = [];
    const client = {
      async execute(arg: string | { sql: string; args?: unknown[] }) {
        if (typeof arg === 'string') {
          executed.push({ sql: arg });
          return { rows: [] };
        }
        executed.push(arg);
        if (/^SELECT/i.test(arg.sql)) {
          return {
            rows: [
              {
                id: 7,
                language: 'en',
                unsubscribe_token: 'B'.repeat(32),
                pending_email_plaintext: 'bad@invalid',
              },
            ],
          };
        }
        return { rows: [], rowsAffected: 1 };
      },
    };
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'invalid recipient' }), { status: 400 });
    });

    const summary = await sendPendingConfirmations({
      env: {
        RESEND_API_KEY: 'rk_test',
        RESEND_FROM: 'sohamhamso <hello@sohamhamso.org>',
        TURSO_PII_URL: 'libsql://example.turso.io',
        TURSO_PII_AUTH_TOKEN: 'tk_test',
      },
      client,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(summary.permanent_failures).toBe(1);
    expect(summary.sent).toBe(0);
    const updates = executed.filter(
      (e) => typeof e.sql === 'string' && /email_failed_at\s*=/i.test(e.sql),
    );
    expect(updates.length).toBe(1);
  });

  it('classifies a 429 as transient — no DB UPDATE (next cron retries)', async () => {
    const updateCalls: string[] = [];
    const client = {
      async execute(arg: string | { sql: string }) {
        if (typeof arg === 'string') return { rows: [] };
        if (/^SELECT/i.test(arg.sql)) {
          return {
            rows: [
              {
                id: 9,
                language: 'en',
                unsubscribe_token: 'C'.repeat(32),
                pending_email_plaintext: 'rate@example.com',
              },
            ],
          };
        }
        if (/^UPDATE/i.test(arg.sql)) updateCalls.push(arg.sql);
        return { rows: [], rowsAffected: 1 };
      },
    };
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 }));

    const summary = await sendPendingConfirmations({
      env: {
        RESEND_API_KEY: 'rk_test',
        RESEND_FROM: 'sohamhamso <hello@sohamhamso.org>',
        TURSO_PII_URL: 'libsql://example.turso.io',
        TURSO_PII_AUTH_TOKEN: 'tk_test',
      },
      client,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(summary.transient_failures).toBe(1);
    expect(summary.sent).toBe(0);
    expect(summary.permanent_failures).toBe(0);
    // Critically: no UPDATE landed — the row stays eligible for the
    // next cron tick.
    expect(updateCalls).toHaveLength(0);
  });
});
