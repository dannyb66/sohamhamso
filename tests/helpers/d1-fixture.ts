// A tiny D1-shaped adapter over Bun's in-memory SQLite. Keeping the fixture
// behind the same prepare().bind().all()/run() surface catches SQL drift
// between local tests and the Cloudflare D1 Worker.
import { Database } from 'bun:sqlite';

export type FixtureSubscriber = {
  id: number;
  email: string | null;
  email_ciphertext: string | null;
  email_nonce: string | null;
  language: string;
  region: 'us' | 'eu';
  confirmed: number;
  unsubscribe_token: string;
};

export type FixtureDelivery = {
  subscriber_id: number;
  delivery_date: string;
  verse_path: string;
  provider_id: string | null;
};

export function makeD1Fixture(): {
  db: Database;
  d1: {
    prepare(sql: string): {
      bind(...values: unknown[]): {
        all<T>(): Promise<{ results: T[] }>;
        run(): Promise<unknown>;
      };
    };
    batch(statements: unknown[]): Promise<unknown>;
  };
  close(): void;
} {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email_hash TEXT NOT NULL,
      email TEXT,
      email_ciphertext TEXT,
      email_nonce TEXT,
      language TEXT NOT NULL DEFAULT 'en',
      subscribed_at TEXT NOT NULL,
      unsubscribe_token TEXT NOT NULL UNIQUE,
      region TEXT NOT NULL CHECK(region IN ('us', 'eu')),
      confirmed INTEGER NOT NULL DEFAULT 0,
      confirmed_at TEXT,
      UNIQUE (email_hash, language)
    );
    CREATE TABLE subscriber_deliveries (
      subscriber_id INTEGER NOT NULL,
      delivery_date TEXT NOT NULL,
      verse_path TEXT NOT NULL,
      provider_id TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (subscriber_id, delivery_date)
    );
  `);

  const d1 = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all<T>() {
              return { results: db.query<T, unknown[]>(sql).all(...values) };
            },
            async run() {
              const result = db.prepare(sql).run(...values);
              return { success: true, meta: { changes: result.changes } };
            },
          };
        },
      };
    },
    async batch(statements: unknown[]) {
      for (const statement of statements) {
        const candidate = statement as { run?: () => unknown };
        candidate.run?.();
      }
    },
  };

  return { db, d1, close: () => db.close() };
}

export function listFixtureSubscribers(db: Database): FixtureSubscriber[] {
  return db.query<FixtureSubscriber, []>('SELECT * FROM subscribers ORDER BY id').all();
}

export function listFixtureDeliveries(db: Database): FixtureDelivery[] {
  return db
    .query<FixtureDelivery, []>(
      'SELECT subscriber_id, delivery_date, verse_path, provider_id FROM subscriber_deliveries ORDER BY subscriber_id',
    )
    .all();
}
