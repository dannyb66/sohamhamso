/** Async SQLite access for local tools and tests. Public readers use generated assets. */

export interface CorpusBatchStatement {
  sql: string;
  args?: ReadonlyArray<string | number | null>;
}

export interface CorpusDb {
  all<T>(sql: string, params?: ReadonlyArray<string | number | null>): Promise<T[]>;
  get<T>(sql: string, params?: ReadonlyArray<string | number | null>): Promise<T | undefined>;
  batch?(
    stmts: ReadonlyArray<CorpusBatchStatement>,
  ): Promise<Array<Array<Record<string, unknown>>>>;
}

export function isEdgeRuntime(): boolean {
  return typeof process === 'undefined' || typeof process.versions?.bun !== 'string';
}

async function makeSqliteBackend(): Promise<CorpusDb> {
  // Keep evaluation safe outside Bun; the public Worker must use static assets.
  const { getDb } = await import('./db');
  const db = getDb();
  return {
    async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
      return db.query<T, (string | number | null)[]>(sql).all(...params);
    },
    async get<T>(
      sql: string,
      params: ReadonlyArray<string | number | null> = [],
    ): Promise<T | undefined> {
      return db.query<T, (string | number | null)[]>(sql).get(...params) ?? undefined;
    },
    async batch(stmts) {
      return stmts.map(({ sql, args = [] }) =>
        db.query<Record<string, unknown>, (string | number | null)[]>(sql).all(...args),
      );
    },
  };
}

let backend: Promise<CorpusDb> | null = null;
let injected: CorpusDb | null = null;

export function getCorpusDb(): Promise<CorpusDb> {
  if (injected) return Promise.resolve(injected);
  if (isEdgeRuntime()) {
    return Promise.reject(
      new Error('Local corpus SQLite is unavailable here; use generated corpus assets.'),
    );
  }
  if (!backend) backend = makeSqliteBackend();
  return backend;
}

/** Test hook: clearing an injected adapter also clears the local connection wrapper. */
export function __setCorpusDbForTests(db: CorpusDb | null): void {
  injected = db;
  backend = null;
}
