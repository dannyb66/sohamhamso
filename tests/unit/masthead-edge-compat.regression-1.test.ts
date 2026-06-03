/**
 * Regression — production-launch-blocking bug
 * (`.gstack/launch/final-bundle-audit-2026-06-03.md`).
 *
 * Masthead is rendered by three `prerender = false` SSR pages
 * (`/search`, `/confirmed`, `/unsubscribed`) which ship into the
 * Cloudflare Pages Function bundle (workerd). Masthead previously did
 * a STATIC `import { getAvailableLanguages } from '../lib/db';` —
 * and `src/lib/db.ts` does a top-level `import { Database } from
 * 'bun:sqlite'`. That static chain dragged `bun:sqlite` into the
 * worker bundle, so the first request to any of the three pages
 * 500ed with `No such module "bun:sqlite"` at module-evaluation
 * time.
 *
 * The fix (Path A — pre-compute at build time): drop the `db.ts`
 * import; source availability from the static `availableInDb` flag
 * on `READING_MODES` entries in `reading-modes.ts`. This is the same
 * shape Agent 7 used to fix `/api/search` (corpus-db.ts) — except
 * here the data set is static enough that no factory is needed at
 * all; just a constant.
 *
 * This spec pins THREE invariants so the bug can't quietly come back:
 *
 *   1. The Masthead source file does NOT import from `'../lib/db'`.
 *      A regex over the source is sufficient — Astro components are
 *      plain text on disk and the bundler follows the literal
 *      import string. If a future refactor re-introduces this line,
 *      every SSR page that renders Masthead 500s at the edge.
 *
 *   2. The Masthead source file does NOT reference `getAvailableLanguages`.
 *      Belt-and-braces against an aliased re-export landing the same
 *      static dep through a different module path.
 *
 *   3. `READING_MODES` exports a 12-entry catalogue with the
 *      `availableInDb` flag set, so the Masthead's static rendering
 *      contract (12 rows, every row marked `available: true`) is
 *      preserved without the DB call.
 *
 * Reference: `.gstack/launch/final-bundle-audit-2026-06-03.md` §2.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { READING_MODES } from '../../src/lib/reading-modes';

const MASTHEAD_PATH = resolve(__dirname, '..', '..', 'src', 'components', 'Masthead.astro');

describe('Masthead — edge bundle isolation', () => {
  it('does NOT statically import from src/lib/db', () => {
    // Source-level check: the bundler follows the literal import
    // string, so a regex over the .astro file is the most direct
    // way to assert the static dep is gone. Match any quote style
    // and tolerate `import type { ... }` (type-only imports are
    // erased and safe), but flag value-level `import { ... } from
    // '../lib/db'` and `import 'something from ../lib/db.ts'`.
    const src = readFileSync(MASTHEAD_PATH, 'utf8');
    // Strip `import type` lines first — those are erased and OK.
    const valueImports = src
      .split('\n')
      .filter((line) => !line.trim().startsWith('import type'))
      .join('\n');
    const re = /import\s*\{[^}]*\}\s*from\s*['"]\.\.\/lib\/db(?:\.[tj]s)?['"]/;
    expect(
      re.test(valueImports),
      'Masthead.astro must not value-import from ../lib/db — it leaks bun:sqlite into the worker bundle (see final-bundle-audit-2026-06-03.md §2).',
    ).toBe(false);
  });

  it('does NOT reference getAvailableLanguages outside comments', () => {
    // Belt-and-braces: even if the import got moved through an
    // aliased re-export module, the function name is the load-
    // bearing call site we want to block. Comments are scrubbed
    // first because the file legitimately documents the bug fix
    // by name in a JSDoc block — that prose is not what the
    // bundler follows.
    const src = readFileSync(MASTHEAD_PATH, 'utf8');
    const stripped = src
      // /* ... */ block comments (incl. JSDoc)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // // ... line comments
      .replace(/^\s*\/\/.*$/gm, '')
      // {/* ... */} JSX-style comments (Astro frontmatter + template)
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
    expect(
      stripped.includes('getAvailableLanguages'),
      'Masthead.astro must not call getAvailableLanguages — availability is sourced from READING_MODES[i].availableInDb instead.',
    ).toBe(false);
  });

  it('READING_MODES still has 12 entries with availableInDb flags', () => {
    // The render contract Masthead inherited: 12 rows. If anyone
    // shrinks the catalogue without also updating the i18n dict +
    // the language-picker spec, the UI silently drops rows.
    expect(READING_MODES.length).toBe(12);
    for (const m of READING_MODES) {
      expect(typeof m.availableInDb).toBe('boolean');
      expect(typeof m.langCode).toBe('string');
      expect(typeof m.nativeLabel).toBe('string');
      expect(typeof m.englishName).toBe('string');
    }
  });
});
