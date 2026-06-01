// Regression lint: ISSUE-006 — `[draft]` bracket-tag leaking into rendered text
//
// The Indic translation/gloss pipeline used a `[draft]` text-prefix as a
// per-verse uncertainty signal that the ingest layer was supposed to
// consume (promoting status to 'draft') and strip from the body. The
// stripping step was missing, so 608 entries across 70 files surfaced
// "[draft]" as visible text in the reader.
//
// Cleanup landed via pipeline/clean-draft-prefix.py. This test guards
// against regression: any new [draft] bracket-tag in any data/translations
// or data/glosses file fails the gate with the exact file + verse key.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DATA_ROOTS = ['data/translations', 'data/glosses'];
const LEAK_PATTERN = /\[draft\]/i;

interface Leak {
  file: string;
  verseKey: string;
  excerpt: string;
}

function walkJson(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(cur, name);
      const st = statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (st.isFile() && name.endsWith('.json')) out.push(full);
    }
  }
  return out;
}

function scanFile(path: string): Leak[] {
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  const verses = payload?.verses;
  if (!verses || typeof verses !== 'object') return [];
  const leaks: Leak[] = [];

  for (const [key, value] of Object.entries(verses)) {
    if (typeof value === 'string') {
      // translations: verses[key] = "translation text"
      if (LEAK_PATTERN.test(value)) {
        leaks.push({ file: path, verseKey: key, excerpt: value.slice(0, 80) });
      }
    } else if (Array.isArray(value)) {
      // glosses: verses[key] = [{ word_idx, gloss_text }, ...]
      for (const entry of value) {
        if (entry && typeof entry === 'object' && typeof entry.gloss_text === 'string') {
          if (LEAK_PATTERN.test(entry.gloss_text)) {
            leaks.push({
              file: path,
              verseKey: `${key}[word_idx=${entry.word_idx}]`,
              excerpt: entry.gloss_text.slice(0, 80),
            });
          }
        }
      }
    }
  }
  return leaks;
}

describe('ISSUE-006 — no [draft] bracket-tag leaks in content JSON', () => {
  it('every translation + gloss JSON file is free of [draft] markers', () => {
    const files = DATA_ROOTS.flatMap(walkJson);
    expect(files.length, 'must find at least one content JSON file').toBeGreaterThan(0);

    const leaks: Leak[] = [];
    for (const f of files) {
      leaks.push(...scanFile(f));
    }

    if (leaks.length > 0) {
      const report = leaks
        .slice(0, 10)
        .map((l) => `  ${l.file} @ ${l.verseKey}: "${l.excerpt}"`)
        .join('\n');
      const more = leaks.length > 10 ? `\n  …and ${leaks.length - 10} more` : '';
      throw new Error(
        `Found ${leaks.length} [draft] marker(s) leaking into content:\n${report}${more}\n\n` +
          `Run \`python3 pipeline/clean-draft-prefix.py\` to strip them, then re-seed the DB.`,
      );
    }

    expect(leaks).toHaveLength(0);
  });
});
