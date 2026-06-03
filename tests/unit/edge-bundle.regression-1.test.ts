/**
 * Regression — production-launch-blocking config.
 *
 * Verifies the Cloudflare Pages `wrangler.toml` exists at the project
 * root and carries the flags the deployment plan demands. Specifically:
 *
 *   1. `compatibility_flags` includes `nodejs_compat`. Without it,
 *      `src/pages/api/subscribe.ts` (top-level `node:crypto` import for
 *      `createHmac` + `randomBytes`) throws at module evaluation on
 *      workerd, and every POST /api/subscribe returns 500.
 *
 *   2. `compatibility_date` is set (any ISO date is fine). Pinning the
 *      date freezes Workerd runtime semantics so a CF upgrade can't
 *      silently change behavior between deploys.
 *
 *   3. `pages_build_output_dir` points at `dist` so Cloudflare Pages
 *      picks up the adapter's emitted `_worker.js/` + assets.
 *
 *   4. `name` is set so `wrangler pages secret put --project <name>`
 *      works from CI without prompting.
 *
 * The check is intentionally a STRING parse, not a TOML parser dep —
 * the file is short, the assertions are regex-stable, and adding a TOML
 * parser to dev-deps for one config file is overkill.
 *
 * Reference: `.gstack/launch/deployment-plan-2026-06-01.md` item #17 and
 * `.gstack/launch/edge-audit-2026-06-01.md` §4 ("wrangler.toml status").
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WRANGLER_PATH = resolve(process.cwd(), 'wrangler.toml');

describe('edge bundle — wrangler.toml launch config', () => {
  it('wrangler.toml exists at project root', () => {
    expect(existsSync(WRANGLER_PATH)).toBe(true);
  });

  it('declares compatibility_flags including nodejs_compat', () => {
    const src = readFileSync(WRANGLER_PATH, 'utf8');
    // Match either inline array or multiline TOML array shape.
    const m = src.match(/^\s*compatibility_flags\s*=\s*\[([^\]]+)\]/m);
    expect(m, 'compatibility_flags = [...] line not found').not.toBeNull();
    const flags = (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
    expect(flags).toContain('nodejs_compat');
  });

  it('pins compatibility_date to an ISO date', () => {
    const src = readFileSync(WRANGLER_PATH, 'utf8');
    const m = src.match(/^\s*compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/m);
    expect(m, 'compatibility_date = "YYYY-MM-DD" line not found').not.toBeNull();
  });

  it('points pages_build_output_dir at the Astro `dist` directory', () => {
    const src = readFileSync(WRANGLER_PATH, 'utf8');
    const m = src.match(/^\s*pages_build_output_dir\s*=\s*"([^"]+)"/m);
    expect(m, 'pages_build_output_dir = "..." line not found').not.toBeNull();
    expect(m?.[1]).toBe('dist');
  });

  it('declares the Pages project `name` for `wrangler pages secret put`', () => {
    const src = readFileSync(WRANGLER_PATH, 'utf8');
    const m = src.match(/^\s*name\s*=\s*"([^"]+)"/m);
    expect(m, 'name = "..." line not found').not.toBeNull();
    expect(m?.[1]).toMatch(/^[a-z0-9-]+$/);
  });
});
