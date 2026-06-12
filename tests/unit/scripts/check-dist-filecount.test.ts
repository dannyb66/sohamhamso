import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CF_PAGES_HARD_LIMIT,
  DEFAULT_LIMIT,
  checkDistFilecount,
  countFiles,
} from '../../../scripts/check-dist-filecount';

describe('check-dist-filecount', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dist-filecount-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('countFiles', () => {
    it('returns 0 for an empty directory', () => {
      expect(countFiles(dir)).toBe(0);
    });

    it('counts files recursively across nested directories', () => {
      writeFileSync(join(dir, 'index.html'), '<html></html>');
      writeFileSync(join(dir, '_headers'), '');
      mkdirSync(join(dir, 'hi', 'trika'), { recursive: true });
      writeFileSync(join(dir, 'hi', 'index.html'), '<html></html>');
      writeFileSync(join(dir, 'hi', 'trika', 'index.html'), '<html></html>');
      expect(countFiles(dir)).toBe(4);
    });

    it('does not count directories themselves', () => {
      mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true });
      expect(countFiles(dir)).toBe(0);
    });
  });

  describe('checkDistFilecount', () => {
    it('passes when count is at or under the limit', () => {
      writeFileSync(join(dir, 'one.html'), '');
      writeFileSync(join(dir, 'two.html'), '');
      const result = checkDistFilecount(dir, 2);
      expect(result.ok).toBe(true);
      expect(result.count).toBe(2);
      expect(result.limit).toBe(2);
    });

    it('fails when count exceeds the limit', () => {
      writeFileSync(join(dir, 'one.html'), '');
      writeFileSync(join(dir, 'two.html'), '');
      writeFileSync(join(dir, 'three.html'), '');
      const result = checkDistFilecount(dir, 2);
      expect(result.ok).toBe(false);
      expect(result.count).toBe(3);
    });

    it('defaults to the 18,000-file gate under the CF Pages hard limit', () => {
      expect(DEFAULT_LIMIT).toBe(18_000);
      expect(DEFAULT_LIMIT).toBeLessThan(CF_PAGES_HARD_LIMIT);
      const result = checkDistFilecount(dir);
      expect(result.limit).toBe(DEFAULT_LIMIT);
    });
  });
});
