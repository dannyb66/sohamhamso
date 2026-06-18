/**
 * Unit tests for the pure statement-builder in
 * scripts/turso-seed-lemma-index.ts. The live Turso round-trip is glue
 * (exercised by operators against a real DB); the row → libSQL statement
 * mapping is the part worth pinning.
 */

import { describe, expect, it } from 'vitest';
import {
  LEMMA_INDEX_DELETE_ALL,
  lemmaIndexInsertStatements,
} from '../../../scripts/turso-seed-lemma-index';

describe('lemmaIndexInsertStatements', () => {
  it('maps each row to a 3-arg INSERT in order', () => {
    const stmts = lemmaIndexInsertStatements([
      { lemma_iast: 'caitanya', slug: 'caitanya', occurrence_count: 3 },
      { lemma_iast: 'śiva', slug: 'siva-2', occurrence_count: 1 },
    ]);
    expect(stmts).toHaveLength(2);
    expect(stmts[0].sql).toContain('INSERT INTO lemma_index');
    expect(stmts[0].args).toEqual(['caitanya', 'caitanya', 3]);
    expect(stmts[1].args).toEqual(['śiva', 'siva-2', 1]);
  });

  it('returns an empty list for no rows', () => {
    expect(lemmaIndexInsertStatements([])).toEqual([]);
  });

  it('exposes a full-clear DELETE for the idempotent replace', () => {
    expect(LEMMA_INDEX_DELETE_ALL).toMatch(/DELETE\s+FROM\s+lemma_index/i);
  });
});
