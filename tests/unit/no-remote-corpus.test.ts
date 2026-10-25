import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { __setCorpusDbForTests, getCorpusDb } from '../../src/lib/corpus-db';

describe('retired database dependency', () => {
  it('does not install the remote SQLite client', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('@libsql/client');
    expect(readFileSync(resolve('bun.lock'), 'utf8').includes('@libsql/client')).toBe(false);
  });

  it('keeps retired credentials and client imports out of executable source and workflows', () => {
    const violations: string[] = [];
    for (const root of ['src', 'scripts', 'pipeline', '.github/workflows']) {
      for (const entry of readdirSync(root, { recursive: true })) {
        const path = resolve(root, String(entry));
        if (!/\.(?:ts|tsx|astro|sh|ya?ml)$/.test(path)) continue;
        if (
          /\bTURSO_(?:CORPUS|PII|API|DB|SEED)[A-Z_]*\b|@libsql\/client/.test(
            readFileSync(path, 'utf8'),
          )
        ) {
          violations.push(path);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('fails locally without making a remote request outside Bun', async () => {
    __setCorpusDbForTests(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.stubGlobal('process', { versions: {} });
    let attempt: ReturnType<typeof getCorpusDb>;
    try {
      attempt = getCorpusDb();
    } finally {
      vi.unstubAllGlobals();
    }
    try {
      await expect(attempt).rejects.toThrow('use generated corpus assets');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
