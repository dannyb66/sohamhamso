import { describe, expect, it } from 'vitest';
import { safeJsonForScript } from '../../src/lib/safe-json';

/**
 * Hostile-content tests for src/lib/safe-json.ts. The corpus is third-party
 * sourced, so any string field may contain `</script>` breakout payloads —
 * the invariant under test is that the serialized output never contains a
 * literal `<` (or raw U+2028/U+2029), making it safe for `set:html` sinks.
 */

describe('safeJsonForScript', () => {
  it('neutralizes a </script> breakout payload (no literal "<")', () => {
    const hostile = 'benign text </script><script>alert(1)</script> more';
    const out = safeJsonForScript({ attribution: hostile });

    expect(out).not.toContain('<');
    expect(out).not.toContain('</script>');
    // Round-trips losslessly: \u003c is still valid JSON for '<'.
    expect(JSON.parse(out)).toEqual({ attribution: hostile });
  });

  it('escapes every "<" occurrence, including nested values', () => {
    const out = safeJsonForScript(['<', { a: '<<' }, ['x<y']]);

    expect(out).not.toContain('<');
    expect(out).toContain('\\u003c');
    expect(JSON.parse(out)).toEqual(['<', { a: '<<' }, ['x<y']]);
  });

  it('escapes U+2028/U+2029 line separators (JS line terminators)', () => {
    const hostile = 'line\u2028sep\u2029arators';
    const out = safeJsonForScript(hostile);

    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
    expect(out).toContain('\\u2028');
    expect(out).toContain('\\u2029');
    expect(JSON.parse(out)).toBe(hostile);
  });

  it('leaves benign payloads identical to JSON.stringify', () => {
    const payload = { devanagari: 'यत्र यत्र मनो याति', verse: 47, glosses: null };
    expect(safeJsonForScript(payload)).toBe(JSON.stringify(payload));
  });
});
