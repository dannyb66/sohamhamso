import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '..', '..', 'pipeline', 'translate', 'merge_indic.py');

// merge_indic.py needs ruamel.yaml; skip (don't fail) on machines without it.
const hasRuamel =
  spawnSync('python3', ['-c', 'import ruamel.yaml'], { encoding: 'utf8' }).status === 0;

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

const CORPUS_YAML = [
  'slug: siva-sutras',
  'chapters:',
  '  - chapter: 1',
  '    verses:',
  '      - verse_num: 1',
  '        devanagari: "चैतन्यमात्मा"',
  '      - verse_num: 2',
  '        devanagari: "ज्ञानं बन्धः"',
  '  - chapter: 2',
  '    verses:',
  '      - verse_num: 1',
  '        devanagari: "चित्तं मन्त्रः"',
  '',
].join('\n');

interface Fixture {
  corpusDir: string;
  transDir: string;
  yamlPath: string;
}

function makeFixture(): Fixture {
  const root = mkdtempSync(resolve(tmpdir(), 'sohamhamso-merge-'));
  tempDirs.push(root);
  const corpusDir = join(root, 'corpus');
  const transDir = join(root, 'translations');
  mkdirSync(corpusDir, { recursive: true });
  mkdirSync(join(transDir, 'siva-sutras'), { recursive: true });
  const yamlPath = join(corpusDir, 'siva-sutras.yaml');
  writeFileSync(yamlPath, CORPUS_YAML, 'utf8');
  return { corpusDir, transDir, yamlPath };
}

function writeShard(fix: Fixture, relPath: string, data: Record<string, unknown>): void {
  const full = join(fix.transDir, 'siva-sutras', relPath);
  mkdirSync(resolve(full, '..'), { recursive: true });
  writeFileSync(full, JSON.stringify(data, null, 2), 'utf8');
}

function shard(verses: Record<string, string>, over: Record<string, unknown> = {}) {
  return {
    text_slug: 'siva-sutras',
    lang: 'hi',
    translator: 'sohamhamso AI pipeline (claude-sonnet-4-6)',
    license: 'CC-BY-SA',
    prompt_version: 'v1-sanskrit-grounded',
    ai_assisted: true,
    status: 'published',
    model: 'claude-sonnet-4-6',
    model_version: 'claude-sonnet-4-5-20250929',
    verses,
    ...over,
  };
}

function runMerge(fix: Fixture): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync('python3', [SCRIPT, 'siva-sutras'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SOHAMHAMSO_CORPUS_DIR: fix.corpusDir,
      SOHAMHAMSO_TRANS_DIR: fix.transDir,
    },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe.skipIf(!hasRuamel)('merge_indic.py', () => {
  it('merges complete per-chapter shards and carries model/model_version from the shard', () => {
    const fix = makeFixture();
    writeShard(fix, 'hi/ch1.json', shard({ '1.1': 'हिन्दी १.१', '1.2': '[draft] हिन्दी १.२' }));
    writeShard(fix, 'hi/ch2.json', shard({ '2.1': 'हिन्दी २.१' }));

    const res = runMerge(fix);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('+3 new');

    const out = readFileSync(fix.yamlPath, 'utf8');
    expect(out).toContain('model: claude-sonnet-4-6');
    expect(out).toContain('model_version: claude-sonnet-4-5-20250929');
    expect(out).not.toContain('claude-opus-4-7'); // no hardcoded model
    expect(out).toContain('status: draft'); // [draft] prefix downgrades
    expect(out).not.toContain('[draft]');
  });

  it('exits nonzero listing missing chapters before merging anything', () => {
    const fix = makeFixture();
    const before = readFileSync(fix.yamlPath, 'utf8');
    writeShard(fix, 'hi/ch1.json', shard({ '1.1': 'हिन्दी १.१' }));
    // ch2.json deliberately missing

    const res = runMerge(fix);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('missing chapter shard(s)');
    expect(res.stderr).toContain('ch2.json');
    expect(readFileSync(fix.yamlPath, 'utf8')).toBe(before); // nothing merged
  });

  it('treats verse-level misses as fatal and leaves the YAML untouched', () => {
    const fix = makeFixture();
    const before = readFileSync(fix.yamlPath, 'utf8');
    writeShard(fix, 'hi.json', shard({ '1.1': 'हिन्दी १.१', '9.9': 'भूत श्लोक' }));

    const res = runMerge(fix);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('9.9');
    expect(res.stderr).toContain('no matching verse');
    expect(readFileSync(fix.yamlPath, 'utf8')).toBe(before);
  });

  it('fails cleanly (no traceback) on a shard missing its lang key', () => {
    const fix = makeFixture();
    const malformed = shard({ '1.1': 'हिन्दी १.१' }) as Record<string, unknown>;
    malformed.lang = undefined;
    writeShard(fix, 'hi.json', malformed);

    const res = runMerge(fix);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("missing required 'lang' key");
    expect(res.stderr).not.toContain('Traceback');
  });

  it('falls back to the translator parenthetical for legacy shards without a model key', () => {
    const fix = makeFixture();
    const legacy = shard(
      { '1.1': 'हिन्दी १.१', '1.2': 'हिन्दी १.२', '2.1': 'हिन्दी २.१' },
      { translator: 'sohamhamso (claude-opus-4-7)' },
    ) as Record<string, unknown>;
    legacy.model = undefined;
    legacy.model_version = undefined;
    writeShard(fix, 'hi.json', legacy);

    const res = runMerge(fix);
    expect(res.status).toBe(0);

    const out = readFileSync(fix.yamlPath, 'utf8');
    expect(out).toContain('model: claude-opus-4-7');
    expect(out).not.toContain('model_version:');
  });
});

if (!hasRuamel) {
  // Visible breadcrumb instead of a silent skip.
  // eslint-disable-next-line no-console
  console.warn('[translate-merge-indic.test] python3 ruamel.yaml not available — suite skipped');
}
