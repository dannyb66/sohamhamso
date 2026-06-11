/**
 * template-version.test.ts
 *
 * Makes the claim in pipeline/youtube/versions.ts TRUE: "ANY change to the
 * Remotion composition source ... MUST bump TEMPLATE_VERSION.
 * template-version.test.ts hashes the composition source and fails CI if it
 * changed without a bump."
 *
 * Mechanism: sha256 over the SHORT composition's source files (Short.tsx +
 * its direct imports), locked together with the TEMPLATE_VERSION value. If
 * either drifts without the other, this test fails with bump instructions.
 *
 * LOCKED AT 'v2' INCLUDING the chapter-format landscape parameterization of
 * Background/Footer/Translation (new OPTIONAL props whose defaults are
 * exactly the previous hardcoded portrait values). That change is the
 * one-time documented TEMPLATE_VERSION exemption (eng decision #19): the
 * Short composition's rendered output is byte-identical, so no bump — a
 * bump would needlessly supersede + re-render all 149 live shorts.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_VERSION } from '../../../pipeline/youtube/versions';

const COMPOSITION_DIR = resolve(__dirname, '..', '..', '..', 'youtube', 'composition');

/**
 * Short.tsx + its DIRECT imports (the files whose changes alter rendered
 * Short pixels). Root.tsx / entry.ts / types.ts are registry/contract files;
 * Chapter-only files (Chapter/TitleCard/OutroCard) version independently
 * under CHAPTER_TEMPLATE_VERSION.
 */
const SHORT_SOURCE_FILES = [
  'Short.tsx',
  'Background.tsx',
  'Devanagari.tsx',
  'fonts.ts',
  'Footer.tsx',
  'Translation.tsx',
  'Transliteration.tsx',
] as const;

/** version + source-hash locked as a PAIR. Update both together (see below). */
const LOCKED = {
  version: 'v2',
  sourceHash: '41d198129f55d22dd5b12f883c09328e640ba847c4e6ec03f9a9dd64219aadec',
} as const;

function currentSourceHash(): string {
  const h = createHash('sha256');
  for (const f of SHORT_SOURCE_FILES) {
    h.update(`${f}\n`);
    h.update(readFileSync(resolve(COMPOSITION_DIR, f), 'utf8'));
  }
  return h.digest('hex');
}

describe('TEMPLATE_VERSION ↔ composition source lock', () => {
  it('TEMPLATE_VERSION matches the locked version', () => {
    expect(
      TEMPLATE_VERSION,
      [
        `TEMPLATE_VERSION changed (locked '${LOCKED.version}', got '${TEMPLATE_VERSION}').`,
        'If this bump is intentional, update LOCKED.version AND LOCKED.sourceHash in',
        'tests/unit/youtube/template-version.test.ts to re-lock the pair.',
      ].join(' '),
    ).toBe(LOCKED.version);
  });

  it('Short composition source is unchanged for the locked TEMPLATE_VERSION', () => {
    const actual = currentSourceHash();
    expect(
      actual,
      [
        'The Short composition source changed without a TEMPLATE_VERSION bump.',
        `Files hashed: ${SHORT_SOURCE_FILES.join(', ')}.`,
        'If the change alters rendered Short pixels (layout, fonts, timing, colors):',
        "  1. bump TEMPLATE_VERSION in pipeline/youtube/versions.ts (e.g. 'v2' -> 'v3') —",
        '     this supersedes + re-renders every live short (intentional cascade);',
        `  2. update LOCKED in this test to {{ version: <new>, sourceHash: '${actual}' }}.`,
        'If the change is provably output-preserving (default-preserving props only,',
        'verified against golden-frame.test.ts), update ONLY LOCKED.sourceHash and',
        'document the exemption in the header comment above.',
      ].join('\n'),
    ).toBe(LOCKED.sourceHash);
  });

  it('hash function is deterministic', () => {
    expect(currentSourceHash()).toBe(currentSourceHash());
  });
});
