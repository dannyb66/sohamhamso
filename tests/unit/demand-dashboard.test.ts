/**
 * Unit tests for the pure demand-instrument helpers:
 *   - src/lib/search-miss.ts   — query sanitizer + day bucket (privacy posture)
 *   - scripts/demand-dashboard.ts — PII COUNT(*)-only guard, Phase 2
 *     slug/alias matcher, window helpers
 *
 * No network, no DB: the runtime sections of the dashboard script only
 * execute when the script is invoked directly (`import.meta.main` guard),
 * and `logSearchMiss` is not exercised here (its corpus-db reach is
 * dynamic — see the module header in search-miss.ts).
 *
 * Run with: `bun --bun vitest run tests/unit/demand-dashboard.test.ts`
 */
import { describe, expect, it } from 'vitest';
import {
  GROWTH_WINDOW_DAYS,
  PHASE2_TEXTS,
  assertCountsOnlySql,
  isoDayAgo,
  matchPhase2,
  normalizeForMatch,
} from '../../scripts/demand-dashboard';
import { MISS_QUERY_MAX_LEN, missDayBucket, sanitizeMissQuery } from '../../src/lib/search-miss';

describe('sanitizeMissQuery', () => {
  it('passes a plain query through unchanged', () => {
    expect(sanitizeMissQuery('tantrasara')).toBe('tantrasara');
  });

  it('replaces control chars (C0 + DEL + C1) with spaces', () => {
    expect(sanitizeMissQuery('a\x00b\x1fc\x7fd\x9fe')).toBe('a b c d e');
  });

  it('neutralizes a log-injection payload (newline + ANSI escape)', () => {
    expect(sanitizeMissQuery('siva\n\x1b[31mFAKE LOG LINE')).toBe('siva [31mFAKE LOG LINE');
  });

  it('collapses whitespace runs and trims the ends', () => {
    expect(sanitizeMissQuery('  spanda \t\t karikas  ')).toBe('spanda karikas');
  });

  it('truncates to MISS_QUERY_MAX_LEN chars', () => {
    const long = 'x'.repeat(500);
    expect(sanitizeMissQuery(long)).toHaveLength(MISS_QUERY_MAX_LEN);
  });

  it('preserves Devanāgarī / Indic-script queries (legit demand signals)', () => {
    expect(sanitizeMissQuery('शिवसूत्र')).toBe('शिवसूत्र');
  });

  it('returns empty string when nothing printable remains', () => {
    expect(sanitizeMissQuery('\x00\x01\x02   ')).toBe('');
  });
});

describe('missDayBucket', () => {
  it('emits a UTC YYYY-MM-DD bucket — no time-of-day correlation', () => {
    expect(missDayBucket(new Date('2026-06-10T23:59:59.999Z'))).toBe('2026-06-10');
    expect(missDayBucket(new Date('2026-06-10T00:00:00.000Z'))).toBe('2026-06-10');
  });
});

describe('assertCountsOnlySql (PII guard)', () => {
  it('allows the bare total count', () => {
    expect(() => assertCountsOnlySql('SELECT COUNT(*) AS n FROM subscribers')).not.toThrow();
  });

  it('allows the windowed growth count', () => {
    expect(() =>
      assertCountsOnlySql('SELECT COUNT(*) AS n FROM subscribers WHERE subscribed_at >= ?'),
    ).not.toThrow();
  });

  it('rejects selecting the email_hash column', () => {
    expect(() => assertCountsOnlySql('SELECT email_hash FROM subscribers')).toThrow(/PII guard/);
  });

  it('rejects email references even inside a COUNT shape', () => {
    expect(() =>
      assertCountsOnlySql("SELECT COUNT(*) AS n FROM subscribers WHERE email_hash = 'x'"),
    ).toThrow(/email/);
  });

  it('rejects SELECT * and non-count select lists', () => {
    expect(() => assertCountsOnlySql('SELECT * FROM subscribers')).toThrow(/PII guard/);
    expect(() => assertCountsOnlySql('SELECT language FROM subscribers')).toThrow(/PII guard/);
  });

  it('rejects queries against other tables', () => {
    expect(() => assertCountsOnlySql('SELECT COUNT(*) FROM verses')).toThrow(/PII guard/);
  });

  it('rejects piggybacked multi-statement SQL', () => {
    expect(() =>
      assertCountsOnlySql('SELECT COUNT(*) FROM subscribers; DROP TABLE subscribers'),
    ).toThrow(/multi-statement/);
  });
});

describe('normalizeForMatch', () => {
  it('lowercases and strips combining diacritics', () => {
    expect(normalizeForMatch('Parātrīśikā')).toBe('paratrisika');
    expect(normalizeForMatch('Tantrasāra')).toBe('tantrasara');
  });

  it('keeps hyphen/space/slash separators intact', () => {
    expect(normalizeForMatch('/trika/gitartha-samgraha/1/1')).toBe('/trika/gitartha-samgraha/1/1');
  });
});

describe('matchPhase2', () => {
  it('buckets miss queries by Phase 2 text, summing counts', () => {
    const out = matchPhase2([
      { value: 'tantrasara abhinavagupta', n: 4 },
      { value: 'Tantrasāra', n: 2 },
      { value: 'shivadrishti somananda', n: 1 },
    ]);
    expect(out).toEqual([
      { slug: 'tantrasara', hits: 6, samples: ['tantrasara abhinavagupta', 'Tantrasāra'] },
      { slug: 'sivadrsti', hits: 1, samples: ['shivadrishti somananda'] },
    ]);
  });

  it('matches 404 URL paths against slug variants', () => {
    const out = matchPhase2([{ value: '/trika/mahanirvana-tantra/1/1', n: 9 }]);
    expect(out).toEqual([
      { slug: 'mahanirvana-tantra', hits: 9, samples: ['/trika/mahanirvana-tantra/1/1'] },
    ]);
  });

  it('drops rows that reference no Phase 2 text', () => {
    expect(matchPhase2([{ value: 'siva sutras 1.1', n: 50 }])).toEqual([]);
  });

  it('sorts buckets by hit count descending', () => {
    const out = matchPhase2([
      { value: 'gitartha', n: 1 },
      { value: 'paratrishika vivarana', n: 7 },
    ]);
    expect(out.map((m) => m.slug)).toEqual(['paratrisika', 'gitartha-samgraha']);
  });

  it('caps stored samples at 3 per text', () => {
    const rows = ['a tantrasara', 'b tantrasara', 'c tantrasara', 'd tantrasara'].map((value) => ({
      value,
      n: 1,
    }));
    const [m] = matchPhase2(rows);
    expect(m.hits).toBe(4);
    expect(m.samples).toHaveLength(3);
  });

  it('every PHASE2_TEXTS variant is already normalized (self-consistency)', () => {
    for (const t of PHASE2_TEXTS) {
      for (const v of t.variants) {
        expect(normalizeForMatch(v)).toBe(v);
      }
    }
  });
});

describe('isoDayAgo', () => {
  it('computes the UTC day N days back', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    expect(isoDayAgo(0, now)).toBe('2026-06-10');
    expect(isoDayAgo(GROWTH_WINDOW_DAYS, now)).toBe('2026-06-03');
    expect(isoDayAgo(28, now)).toBe('2026-05-13');
  });
});
