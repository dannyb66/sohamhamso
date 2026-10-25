/** Runtime-selectable database backend configuration. */

export type DbBackend = 'sqlite' | 'd1';

/** Resolve an explicit backend while preserving the existing runtime default. */
export function resolveDbBackend(value: string | undefined, isBun: boolean): DbBackend {
  const configured = (value ?? 'auto').trim().toLowerCase();
  if (configured === 'auto') return isBun ? 'sqlite' : 'd1';
  if (configured === 'd1') return 'd1';
  if (configured === 'sqlite') {
    if (!isBun) {
      throw new Error(
        'SQLite backend is unavailable in the edge runtime; run self-hosted Bun or use the PII_DB D1 binding.',
      );
    }
    return 'sqlite';
  }
  throw new Error(`Invalid database backend "${value}"; expected auto, sqlite, or d1.`);
}
