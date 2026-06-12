/**
 * prose.ts — section_type-aware rendering helpers (plan A4, render side).
 *
 * Two render modes exist for a verses-table row:
 *   - 'verse' (default): Devanāgarī/IAST are split on dandas by
 *     `formatDanda` (each pāda-pair on its own line, `white-space:
 *     pre-line` in VerseAnatomy).
 *   - 'prose': the block BYPASSES `formatDanda` entirely. Prose flows as
 *     paragraphs — splitting a running commentary sentence on every danda
 *     would shred it into a fake-verse line stack. `splitProseParagraphs`
 *     is the only transform applied (blank-line paragraph breaks).
 *
 * These are pure functions in a plain module (not inlined in the .astro
 * frontmatter) so unit tests can pin the contract — this project's vitest
 * config cannot render .astro files (see tests/unit/seo/breadcrumbs.test.ts).
 */

/** True when a verses-table row is a prose block (section_type='prose'). */
export function isProseSection(sectionType: string | null | undefined): boolean {
  return sectionType === 'prose';
}

/**
 * Split prose content (Devanāgarī, IAST or a translation) into flowing
 * paragraphs on blank lines (`\n\n`). Within a paragraph all whitespace —
 * including single newlines — collapses to a single space: prose renders
 * with `white-space: normal`, never the verse path's `pre-line`.
 *
 * NEVER splits on dandas. A prose block with twelve sentence-final dandas
 * is still one paragraph unless the source contains blank lines.
 */
export function splitProseParagraphs(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Short-verse heuristic (audit 2026-06-01 #13): aphoristic sūtras like
 * Śiva Sūtra 1.1 ("Consciousness is the Self.") leave huge empty space
 * below the prev/next nav, so the verse pages render a quiet "Continue
 * reading" affordance when translation < 200 chars OR no word-by-word
 * glosses.
 *
 * GUARD: prose blocks ship NO word glosses in V1 (`glossCount === 0` by
 * design), and their translations are full paragraphs — the heuristic
 * must never fire for section_type='prose'.
 */
export function computeIsShortVerse(opts: {
  sectionType: string | null | undefined;
  translationLength: number;
  glossCount: number;
}): boolean {
  if (isProseSection(opts.sectionType)) return false;
  return opts.translationLength < 200 || opts.glossCount === 0;
}

/**
 * Break Sanskrit VERSES on the half-verse danda (Devanāgarī ।, ॥; IAST
 * | , || ). Vedabase / SuttaCentral convention: each pāda-pair on its own
 * line. The verse-number bracket ॥N॥ / ||N|| stays attached to its
 * preceding pāda (it marks the end of the verse). Paired with
 * `white-space: pre-line` in VerseAnatomy's CSS.
 *
 * Verse mode ONLY — prose blocks must go through `splitProseParagraphs`
 * instead (see module docs above). Moved verbatim from VerseAnatomy.astro
 * frontmatter so the danda-shredding contract is unit-testable.
 */
export function formatDanda(s: string | null | undefined): string {
  if (!s) return '';
  // Normalize slash-style IAST dandas (Karpūrādi Stotra and some other
  // corpora use / and // instead of | and || for pāda separators) to
  // pipe-style so the existing logic below handles both uniformly.
  // Slashes don't occur in normal IAST text, so this is a safe rewrite.
  // Order matters: replace // before / so the longer match wins.
  // (Local variable instead of reassigning `s` — biome noParameterAssign;
  // the .astro original predates linting and reassigned the parameter.)
  const normalized = s.replace(/\/\//g, '||').replace(/\//g, '|');
  // Protect verse-number brackets so the internal dandas don't get split.
  // Devanāgarī forms: ॥४९॥, ॥ ४९ ॥. IAST forms: ||49||, || 49 ||.
  const protected_: string[] = [];
  let work = normalized
    .replace(/॥\s*([\d०-९]+)\s*॥/g, (_m, n) => {
      protected_.push(`॥${n}॥`);
      return `${protected_.length - 1}`;
    })
    .replace(/\|\|\s*(\d+)\s*\|\|/g, (_m, n) => {
      protected_.push(`||${n}||`);
      return `${protected_.length - 1}`;
    });

  work = work
    // Newline after Devanāgarī dandas
    .replace(/॥/g, '॥\n')
    .replace(/।/g, '।\n')
    // Newline after IAST dandas — || before single |
    .replace(/\|\|/g, '||\n')
    .replace(/(^|[^|])\|(?!\|)/g, '$1|\n');

  // Restore the protected verse-number brackets
  work = work.replace(/(\d+)/g, (_m, i) => protected_[Number(i)]);

  // Collapse multiple newlines + trim
  return work
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}
