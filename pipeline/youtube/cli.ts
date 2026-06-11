/**
 * pipeline/youtube/cli.ts
 *
 * Shared argv parsing for every `scripts/youtube-*.ts` entry point, per
 * `pipeline/youtube/CLI-CONVENTIONS.md` (D3). Manual parse (no commander
 * dep), mirroring `scripts/seo-verify-phase0.ts`.
 *
 * Exit codes (CLI-CONVENTIONS): 0 ok, 1 runtime, 2 usage, 3 config/gate.
 */

export interface CommonArgs {
  help: boolean;
  json: boolean;
  dryRun: boolean;
  limit?: number;
  textSlug?: string;
  lang?: string;
  force: boolean;
  /** Any extra `--key=value` pairs not in the common set. */
  extra: Record<string, string>;
  /** Bare positional args (no leading `--`). */
  positionals: string[];
}

/**
 * Parse a recognised set of common flags. `allowed` is the set of EXTRA
 * `--key` names this script accepts beyond the common ones; any unknown
 * `--flag` throws a usage error (exit 2 — caller catches).
 */
export function parseCommonArgs(argv: string[], allowed: string[] = []): CommonArgs {
  const out: CommonArgs = {
    help: false,
    json: false,
    dryRun: false,
    force: false,
    extra: {},
    positionals: [],
  };
  const allowedSet = new Set(allowed);

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      out.help = true;
    } else if (arg === '--json') {
      out.json = true;
    } else if (arg === '--dry-run') {
      out.dryRun = true;
    } else if (arg === '--force') {
      out.force = true;
    } else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`bad --limit: ${arg}`);
      out.limit = n;
    } else if (arg.startsWith('--text-slug=')) {
      out.textSlug = arg.slice('--text-slug='.length);
    } else if (arg.startsWith('--lang=')) {
      out.lang = arg.slice('--lang='.length);
    } else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      const val = eq === -1 ? '' : arg.slice(eq + 1);
      if (!allowedSet.has(key)) throw new UsageError(`unknown flag: --${key}`);
      out.extra[key] = val;
    } else {
      out.positionals.push(arg);
    }
  }
  return out;
}

/** Thrown on an unknown/malformed flag — caller maps to exit code 2. */
export class UsageError extends Error {}

/** Today's UTC date as YYYY-MM-DD (quota bucketing key). */
export function utcDate(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}
