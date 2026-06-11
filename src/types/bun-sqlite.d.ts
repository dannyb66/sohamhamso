// Minimal ambient declaration for Bun's built-in SQLite driver.
// The full surface lives in bun-types; this shim covers what we use across
// the codebase so `tsc --noEmit` stops flagging "Cannot find module 'bun:sqlite'".
declare module 'bun:sqlite' {
  export interface Statement<TRow = unknown, TParams extends unknown[] = unknown[]> {
    all(...params: TParams): TRow[];
    get(...params: TParams): TRow | undefined;
    run(...params: TParams): { changes: number; lastInsertRowid: number };
    finalize(): void;
  }

  export class Database {
    constructor(filename?: string, options?: { readonly?: boolean; create?: boolean });
    prepare<TRow = unknown, TParams extends unknown[] = unknown[]>(
      sql: string,
    ): Statement<TRow, TParams>;
    query<TRow = unknown, TParams extends unknown[] = unknown[]>(
      sql: string,
    ): Statement<TRow, TParams>;
    exec(sql: string): void;
    // biome-ignore lint/suspicious/noExplicitAny: transaction wraps arbitrary work
    transaction<T extends (...args: any[]) => any>(fn: T): T;
    close(): void;
  }
}

// Minimal global declarations for Bun's globals used in pipeline scripts.
// (Bun.write, Bun.file). The full surface is in bun-types; we only need
// the entry points the pipeline references so tsc --noEmit stops complaining.
interface BunSubprocess {
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  kill(signal?: number | string): void;
}

declare const Bun: {
  write(path: string, data: string | ArrayBuffer | Uint8Array | Blob): Promise<number>;
  file(path: string): {
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    arrayBuffer(): Promise<ArrayBuffer>;
    exists(): Promise<boolean>;
    size: number;
  };
  // Minimal subprocess surface used by the youtube pipeline (aws s3 cp).
  spawn(
    cmd: string[],
    options?: {
      env?: Record<string, string | undefined>;
      stdout?: 'pipe' | 'inherit' | 'ignore';
      stderr?: 'pipe' | 'inherit' | 'ignore';
      cwd?: string;
    },
  ): BunSubprocess;
  env: Record<string, string | undefined>;
  argv: string[];
};
