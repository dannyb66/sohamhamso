import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMA_JSON_PATH, renderCorpusSchemaJson } from '../../scripts/schema-gen';

describe('schema-gen freshness', () => {
  it('committed data/corpus/schema.json matches the generated output', () => {
    const committed = readFileSync(SCHEMA_JSON_PATH, 'utf8');
    expect(committed).toBe(renderCorpusSchemaJson());
  });
});
