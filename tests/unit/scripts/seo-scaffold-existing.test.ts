import { describe, expect, it } from 'vitest';
import {
  LANGS,
  buildScaffold,
  hasSchemaVersion,
  hasSeoBlock,
} from '../../../scripts/seo-scaffold-existing';

describe('seo-scaffold-existing', () => {
  describe('buildScaffold', () => {
    const scaffold = buildScaffold('test-slug');

    it('contains a commented schema_version: 1', () => {
      expect(scaffold).toContain('# schema_version: 1');
    });

    it('contains a commented seo: header', () => {
      expect(scaffold).toContain('# seo:');
      expect(scaffold).toContain('#   descriptions:');
      expect(scaffold).toContain('#   keywords:');
    });

    it('contains noindex_langs: []', () => {
      expect(scaffold).toContain('noindex_langs: []');
    });

    it('contains one description TODO line per locale', () => {
      for (const lang of LANGS) {
        const expected = `#     ${lang}: ""  # TODO: 140-160 char native-script ${lang} description for test-slug`;
        expect(scaffold).toContain(expected);
      }
    });

    it('contains one keywords TODO line per locale', () => {
      for (const lang of LANGS) {
        const expected = `#     ${lang}: []  # TODO: 3-6 ${lang} keywords (native script for non-en)`;
        expect(scaffold).toContain(expected);
      }
    });

    it('emits all 12 description locale lines', () => {
      const matches = scaffold.match(/^# {5}[a-z]{2}: ""/gm) ?? [];
      expect(matches).toHaveLength(12);
    });

    it('emits all 12 keyword locale lines', () => {
      const matches = scaffold.match(/^# {5}[a-z]{2}: \[\]/gm) ?? [];
      expect(matches).toHaveLength(12);
    });

    it('every output line begins with # (entire block commented)', () => {
      const codeLines = scaffold
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of codeLines) {
        expect(line.startsWith('#')).toBe(true);
      }
    });

    it('interpolates the slug into the description TODOs', () => {
      const out = buildScaffold('siva-sutras');
      expect(out).toContain('description for siva-sutras');
    });
  });

  describe('hasSeoBlock', () => {
    it('returns true when seo: appears at column 0', () => {
      expect(hasSeoBlock('text:\n  id: x\nseo:\n  descriptions: {}\n')).toBe(true);
    });

    it('returns false for a fully commented-out seo: scaffold', () => {
      expect(hasSeoBlock('text:\n  id: x\n# seo:\n#   descriptions: {}\n')).toBe(false);
    });

    it('returns false when no seo block is present', () => {
      expect(hasSeoBlock('text:\n  id: x\n')).toBe(false);
    });
  });

  describe('hasSchemaVersion', () => {
    it('returns true when schema_version: appears at column 0', () => {
      expect(hasSchemaVersion('schema_version: 1\ntext:\n  id: x\n')).toBe(true);
    });

    it('returns false when schema_version is only commented', () => {
      expect(hasSchemaVersion('# schema_version: 1\ntext:\n  id: x\n')).toBe(false);
    });
  });
});
