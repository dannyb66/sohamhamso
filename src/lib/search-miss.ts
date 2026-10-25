/** Pure sanitizers for historical search-miss reports. Website search does not log queries. */

/** Hard cap on stored query length (chars, post-sanitization). */
export const MISS_QUERY_MAX_LEN = 80;

/**
 * Sanitize a raw search query for storage:
 *   - control chars (C0 + DEL + C1) → space (kills log-injection / weird
 *     terminal escapes in the dashboard readout)
 *   - whitespace runs collapsed to a single space, ends trimmed
 *   - truncated to MISS_QUERY_MAX_LEN chars
 *
 * Unicode letters are PRESERVED — Devanāgarī / Indic-script queries are
 * legitimate demand signals, not noise.
 *
 * Exported for unit-test coverage (tests/unit/demand-dashboard.test.ts).
 */
export function sanitizeMissQuery(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is this sanitizer's job
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MISS_QUERY_MAX_LEN)
  );
}

/**
 * Day-bucket timestamp: YYYY-MM-DD (UTC). Coarse on purpose — see the
 * privacy posture in the module header.
 */
export function missDayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
