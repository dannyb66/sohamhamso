/**
 * Cloudflare Worker — scheduled handler that sends pending double-opt-in
 * confirmation emails via Resend.
 *
 * DEPLOY MODEL (per deployment plan §"Code work" step 9):
 *   Cloudflare Pages Functions do NOT support cron triggers. This file
 *   is therefore designed to deploy as a STANDALONE Worker with a cron
 *   schedule (e.g. `*\/5 * * * *`), separate from the Pages project
 *   that serves the reader. See `docs/EMAIL.md` for the wrangler
 *   deploy walkthrough.
 *
 * RUNTIME CONTRACT:
 *   - Env is passed in via the `scheduled(event, env, ctx)` handler;
 *     we do NOT read `process.env.*` at the edge (it's `env.*`).
 *   - `sendPendingConfirmations({ env })` is the pure function. It
 *     accepts the env object so tests can drive it without bun-vs-edge
 *     guards.
 *   - When `RESEND_API_KEY` is unset: log + early-return cleanly
 *     (no-op for dev / local cron invocations).
 *   - When `RESEND_FROM` is unset: log + early-return (we won't ship
 *     mail from an unconfigured sender).
 *
 * IDEMPOTENCY:
 *   The send query gates on `email_sent_at IS NULL AND email_failed_at
 *   IS NULL`. After a successful POST to Resend we set `email_sent_at
 *   = now`. After a permanent 4xx failure (bad address) we set
 *   `email_failed_at = now`. Transient failures (429, 5xx) leave both
 *   columns NULL so the next cron tick retries.
 *
 * QUERY WINDOW:
 *   `subscribed_at > now - 24h`. Past 24 hours, an unconfirmed row is
 *   stale — we don't surprise-email a user a week after they typed
 *   their address. Stale rows are GC'd by a separate sweep (out of
 *   scope for this file).
 *
 * LOGGING:
 *   Structured one-line `[email] {action} ...` so Cloudflare Workers
 *   tail logs are greppable. No PII in logs (the email_hash is opaque;
 *   never log the recipient address).
 *
 *   NOTE: this Worker does NOT have access to plaintext email
 *   addresses — `subscribers.email_hash` is HMAC(email, pepper). To
 *   actually send mail we'd need either: (a) a small one-way write of
 *   the plaintext at subscribe time into a SHORT-LIVED column that
 *   the Worker reads then nulls, or (b) a redesign so the subscribe
 *   handler itself queues the send synchronously. THIS FILE assumes
 *   option (a) — the row has a `pending_email_plaintext` column that
 *   the Worker reads + clears after a successful send. The schema
 *   migration (db/migrations/0001-add-email-tracking.sql) adds it.
 *   The subscribe handler is owned by another agent and is not
 *   modified here — flagged as a follow-up in docs/EMAIL.md.
 */

import { confirmEmail } from './templates/confirm-email';

/* ─── Env shape ─────────────────────────────────────────────────── */

export interface WorkerEnv {
  RESEND_API_KEY?: string;
  /** Verified sender, e.g. `"sohamhamso <hello@sohamhamso.org>"`. */
  RESEND_FROM?: string;
  /** Origin used to build confirm/unsubscribe URLs. Default: production. */
  PUBLIC_BASE_URL?: string;
  /** libSQL DB URL — Turso PII DB. Same env var the API handlers use. */
  TURSO_PII_URL?: string;
  TURSO_PII_AUTH_TOKEN?: string;
}

/* ─── DB row shape ──────────────────────────────────────────────── */

interface PendingRow {
  id: number;
  language: string;
  unsubscribe_token: string;
  pending_email_plaintext: string | null;
}

/* ─── Main entry point ─────────────────────────────────────────── */

export interface SendSummary {
  attempted: number;
  sent: number;
  permanent_failures: number;
  transient_failures: number;
  skipped: number;
}

/**
 * Send pending confirmation emails. Pure function over `env` — no
 * implicit globals, so tests can drive it without a real edge runtime.
 *
 * The optional `{ client, fetchImpl }` hooks let tests substitute the
 * DB + HTTP layer. Production callers (the `scheduled` handler below)
 * leave them undefined; the function provisions a real libsql client
 * and uses global fetch.
 */
export async function sendPendingConfirmations(opts: {
  env: WorkerEnv;
  // biome-ignore lint/suspicious/noExplicitAny: test-injection hook for libsql client
  client?: any;
  fetchImpl?: typeof fetch;
}): Promise<SendSummary> {
  const { env } = opts;
  const summary: SendSummary = {
    attempted: 0,
    sent: 0,
    permanent_failures: 0,
    transient_failures: 0,
    skipped: 0,
  };

  // No-op cleanly in dev / unconfigured environments.
  if (!env.RESEND_API_KEY) {
    console.log('[email] skip: RESEND_API_KEY unset (dev no-op)');
    return summary;
  }
  if (!env.RESEND_FROM) {
    console.log('[email] skip: RESEND_FROM unset');
    return summary;
  }
  if (!env.TURSO_PII_URL || !env.TURSO_PII_AUTH_TOKEN) {
    console.log('[email] skip: TURSO_PII_URL/AUTH_TOKEN unset');
    return summary;
  }

  const baseUrl = (env.PUBLIC_BASE_URL ?? 'https://sohamhamso.org').replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;

  const client = opts.client ?? (await provisionLibsqlClient(env));

  // Pull pending rows: unconfirmed, not yet email-sent, not yet
  // permanently failed, subscribed in the last 24h.
  const rows = await selectPending(client);
  summary.attempted = rows.length;

  for (const row of rows) {
    // The Worker reads the plaintext email from the row, sends, then
    // nulls the column. If the column is empty the row was either
    // already processed or arrived from a subscribe handler that
    // doesn't yet write the plaintext (see file header note).
    if (!row.pending_email_plaintext) {
      console.log(`[email] skip id=${row.id}: pending_email_plaintext empty`);
      summary.skipped++;
      continue;
    }

    const payload = confirmEmail({
      lang: row.language,
      unsubscribeToken: row.unsubscribe_token,
      baseUrl,
    });

    const result = await postToResend({
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM,
      to: row.pending_email_plaintext,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      fetchImpl,
    });

    if (result.kind === 'sent') {
      await markSent(client, row.id);
      console.log(`[email] sent id=${row.id} provider_id=${result.providerId}`);
      summary.sent++;
    } else if (result.kind === 'permanent_failure') {
      await markFailed(client, row.id);
      console.log(
        `[email] permanent_fail id=${row.id} status=${result.status} body=${truncate(result.body)}`,
      );
      summary.permanent_failures++;
    } else {
      // Transient — leave both columns NULL so the next cron retries.
      console.log(
        `[email] transient_fail id=${row.id} status=${result.status} body=${truncate(result.body)}`,
      );
      summary.transient_failures++;
    }
  }

  return summary;
}

/* ─── HTTP — Resend POST ───────────────────────────────────────── */

interface ResendResult {
  kind: 'sent' | 'permanent_failure' | 'transient_failure';
  status: number;
  body: string;
  providerId?: string;
}

async function postToResend(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  fetchImpl: typeof fetch;
}): Promise<ResendResult> {
  let res: Response;
  try {
    res = await args.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
  } catch (err) {
    // Network-level failure (DNS, TLS, etc.) — treat as transient.
    return {
      kind: 'transient_failure',
      status: 0,
      body: `fetch-threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const bodyText = await safeText(res);

  if (res.status >= 200 && res.status < 300) {
    let providerId: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { id?: string };
      providerId = parsed.id;
    } catch {
      // Resend almost always returns JSON, but don't fail the send
      // accounting just because the parse blew up.
    }
    return { kind: 'sent', status: res.status, body: bodyText, providerId };
  }

  // 4xx (except 408, 429) → permanent. The address is bad, the API
  // key is wrong, the domain isn't verified — retrying won't help.
  if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
    return { kind: 'permanent_failure', status: res.status, body: bodyText };
  }

  // 408, 429, 5xx → transient. Next cron tick retries.
  return { kind: 'transient_failure', status: res.status, body: bodyText };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, max = 200): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/* ─── DB — libsql client + queries ─────────────────────────────── */

async function provisionLibsqlClient(env: WorkerEnv): Promise<unknown> {
  if (!env.TURSO_PII_URL || !env.TURSO_PII_AUTH_TOKEN) {
    throw new Error('provisionLibsqlClient: Turso env not set');
  }
  const { createClient } = await import('@libsql/client/web');
  return createClient({ url: env.TURSO_PII_URL, authToken: env.TURSO_PII_AUTH_TOKEN });
}

// biome-ignore lint/suspicious/noExplicitAny: libsql client surface is opaque here
async function selectPending(client: any): Promise<PendingRow[]> {
  // Cold-start safety: ensure tracking columns exist. The confirm
  // helper does the same on its first run, but this Worker may be the
  // FIRST caller against a fresh DB (it runs on a cron, independent
  // of the API surface). Idempotent — duplicate-column errors are
  // swallowed in `libsqlSafeAlter`.
  await libsqlSafeAlter(client, 'ALTER TABLE subscribers ADD COLUMN email_sent_at TEXT;');
  await libsqlSafeAlter(client, 'ALTER TABLE subscribers ADD COLUMN email_failed_at TEXT;');
  await libsqlSafeAlter(client, 'ALTER TABLE subscribers ADD COLUMN pending_email_plaintext TEXT;');

  const res = await client.execute({
    sql: `SELECT id, language, unsubscribe_token, pending_email_plaintext
            FROM subscribers
           WHERE confirmed_at IS NULL
             AND email_sent_at IS NULL
             AND email_failed_at IS NULL
             AND subscribed_at > datetime('now', '-24 hours')
           ORDER BY subscribed_at ASC
           LIMIT 100`,
    args: [],
  });
  return (res.rows ?? []).map((r: unknown) => {
    const row = r as {
      id: number | bigint;
      language: string;
      unsubscribe_token: string;
      pending_email_plaintext: string | null;
    };
    return {
      id: Number(row.id),
      language: row.language,
      unsubscribe_token: row.unsubscribe_token,
      pending_email_plaintext: row.pending_email_plaintext ?? null,
    };
  });
}

// biome-ignore lint/suspicious/noExplicitAny: libsql client surface is opaque here
async function markSent(client: any, id: number): Promise<void> {
  await client.execute({
    sql: `UPDATE subscribers
             SET email_sent_at = datetime('now'),
                 pending_email_plaintext = NULL
           WHERE id = ?`,
    args: [id],
  });
}

// biome-ignore lint/suspicious/noExplicitAny: libsql client surface is opaque here
async function markFailed(client: any, id: number): Promise<void> {
  await client.execute({
    sql: `UPDATE subscribers
             SET email_failed_at = datetime('now'),
                 pending_email_plaintext = NULL
           WHERE id = ?`,
    args: [id],
  });
}

// biome-ignore lint/suspicious/noExplicitAny: libsql client surface is opaque here
async function libsqlSafeAlter(client: any, sql: string): Promise<void> {
  try {
    await client.execute(sql);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
}

function isDuplicateColumnError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as { message?: unknown; proto?: unknown };
  if (typeof e.message === 'string' && /duplicate column name/i.test(e.message)) return true;
  if (e.proto != null && typeof e.proto === 'object') {
    const p = e.proto as { message?: unknown };
    if (typeof p.message === 'string' && /duplicate column name/i.test(p.message)) return true;
  }
  return false;
}

/* ─── Scheduled-handler wrapper (Worker default export) ────────── */

/**
 * Drop-in Worker handler. Deploy via `wrangler deploy` with a
 * `triggers.crons` entry in `wrangler.toml`. See docs/EMAIL.md.
 */
export default {
  async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
    const summary = await sendPendingConfirmations({ env });
    console.log(`[email] cron summary ${JSON.stringify(summary)}`);
  },
};
