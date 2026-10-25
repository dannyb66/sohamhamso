import { afterEach, describe, expect, it } from 'vitest';
import {
  __setSubscriberConfirmForTests,
  getSubscriberConfirm,
} from '../../src/lib/subscriber-confirm';
import {
  type D1Database,
  SubscriberUniqueViolation,
  __setSubscriberDbForTests,
  getSubscriberDb,
} from '../../src/lib/subscriber-db';
import { makeD1Fixture } from '../helpers/d1-fixture';

type BoundCall = { sql: string; values: unknown[] };

function fakeD1(options: { duplicate?: boolean } = {}): {
  db: D1Database;
  runs: BoundCall[];
  reads: BoundCall[];
} {
  const runs: BoundCall[] = [];
  const reads: BoundCall[] = [];
  return {
    runs,
    reads,
    db: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async run() {
                runs.push({ sql, values });
                if (options.duplicate)
                  throw new Error('UNIQUE constraint failed: subscribers.email_hash');
                return { success: true };
              },
              async all<T>() {
                reads.push({ sql, values });
                return { results: [{ one: 1 }] as T[] };
              },
            };
          },
        };
      },
    },
  };
}

afterEach(() => {
  // biome-ignore lint/performance/noDelete: remove the override rather than stringify undefined.
  delete process.env.SOHAMHAMSO_PII_DB_BACKEND;
  __setSubscriberDbForTests(null);
  __setSubscriberConfirmForTests(null);
});

describe('D1 subscriber backend', () => {
  it('confirms and deletes using real D1-shaped change counts', async () => {
    process.env.SOHAMHAMSO_PII_DB_BACKEND = 'd1';
    const fixture = makeD1Fixture();
    try {
      const subscribers = await getSubscriberDb({ PII_DB: fixture.d1 });
      await subscribers.insertSubscriber({
        email_hash: 'real-hash',
        language: 'en',
        region: 'us',
        unsubscribe_token: 'A'.repeat(32),
        subscribed_at: '2026-09-16T00:00:00.000Z',
      });
      const backend = await getSubscriberConfirm({ PII_DB: fixture.d1 });

      expect(await backend.confirmByToken('missing')).toEqual({ status: 'unknown' });
      expect(await backend.confirmByToken('A'.repeat(32))).toEqual({ status: 'confirmed' });
      const row = fixture.db
        .query<{ confirmed: number; confirmed_at: string | null }, []>(
          'SELECT confirmed, confirmed_at FROM subscribers',
        )
        .get();
      expect(row?.confirmed).toBe(1);
      expect(row?.confirmed_at).toBeTruthy();

      expect(await backend.deleteByToken('missing')).toEqual({ deleted: false });
      expect(await backend.deleteByToken('A'.repeat(32))).toEqual({ deleted: true });
      expect(await backend.deleteByToken('A'.repeat(32))).toEqual({ deleted: false });
      expect(fixture.db.query('SELECT * FROM subscribers').all()).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it('preserves the original confirmation timestamp when a link is clicked again', async () => {
    process.env.SOHAMHAMSO_PII_DB_BACKEND = 'd1';
    const fixture = makeD1Fixture();
    const original = '2026-09-16 06:00:00';
    try {
      fixture.db
        .prepare(
          `INSERT INTO subscribers
             (email_hash, language, region, unsubscribe_token, subscribed_at, confirmed, confirmed_at)
           VALUES (?, 'en', 'us', ?, ?, 1, ?)`,
        )
        .run('confirmed-hash', 'B'.repeat(32), original, original);
      const backend = await getSubscriberConfirm({ PII_DB: fixture.d1 });

      expect(await backend.confirmByToken('B'.repeat(32))).toEqual({ status: 'confirmed' });
      expect(
        fixture.db.query<{ confirmed_at: string }, []>('SELECT confirmed_at FROM subscribers').get()
          ?.confirmed_at,
      ).toBe(original);
    } finally {
      fixture.close();
    }
  });

  it('uses the bound D1 database for reads and writes', async () => {
    process.env.SOHAMHAMSO_PII_DB_BACKEND = 'd1';
    const fake = fakeD1();
    const db = await getSubscriberDb({ PII_DB: fake.db });

    await db.insertSubscriber({
      email_hash: 'hash',
      language: 'en',
      region: 'us',
      unsubscribe_token: 'token',
      subscribed_at: '2026-09-16T00:00:00.000Z',
    });
    expect(await db.isAlreadySubscribed('hash', 'en')).toBe(true);

    expect(fake.runs).toHaveLength(1);
    expect(fake.runs[0].sql).toContain('INSERT INTO subscribers');
    expect(fake.reads).toHaveLength(1);
    expect(fake.reads[0].sql).toContain('SELECT 1 AS one');
  });

  it('normalizes D1 unique errors for idempotent subscribe handling', async () => {
    process.env.SOHAMHAMSO_PII_DB_BACKEND = 'd1';
    const fake = fakeD1({ duplicate: true });
    const db = await getSubscriberDb({ PII_DB: fake.db });

    await expect(
      db.insertSubscriber({
        email_hash: 'hash',
        language: 'en',
        region: 'us',
        unsubscribe_token: 'token',
        subscribed_at: '2026-09-16T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(SubscriberUniqueViolation);
  });
});
