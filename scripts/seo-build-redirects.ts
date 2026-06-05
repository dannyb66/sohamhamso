import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enumerateRedirectPairs } from '../src/lib/aliases';
import { READING_MODES } from '../src/lib/reading-modes';

export interface RedirectPair {
  wrongTradition: string;
  wrongSlug: string;
  canonicalTradition: string;
  canonicalSlug: string;
}

export interface RedirectRule {
  from: string;
  to: string;
  status: 301;
}

export const NON_ENGLISH_LOCALES = READING_MODES.filter((mode) => mode.langCode !== 'en').map(
  (mode) => mode.langCode,
);

function buildExactRule(locale: string | null, pair: RedirectPair): RedirectRule {
  const prefix = locale ? `/${locale}` : '';
  return {
    from: `${prefix}/${pair.wrongTradition}/${pair.wrongSlug}`,
    to: `${prefix}/${pair.canonicalTradition}/${pair.canonicalSlug}`,
    status: 301,
  };
}

function buildVerseRule(locale: string | null, pair: RedirectPair): RedirectRule {
  const prefix = locale ? `/${locale}` : '';
  return {
    from: `${prefix}/${pair.wrongTradition}/${pair.wrongSlug}/*`,
    to: `${prefix}/${pair.canonicalTradition}/${pair.canonicalSlug}/:splat`,
    status: 301,
  };
}

export function buildRedirectRules(
  pairs: readonly RedirectPair[],
  locales: readonly string[] = NON_ENGLISH_LOCALES,
): RedirectRule[] {
  const rules = new Map<string, RedirectRule>();

  const push = (rule: RedirectRule) => {
    rules.set(`${rule.from} ${rule.to} ${rule.status}`, rule);
  };

  for (const pair of pairs) {
    push(buildExactRule(null, pair));
    push(buildVerseRule(null, pair));

    for (const locale of locales) {
      push(buildExactRule(locale, pair));
      push(buildVerseRule(locale, pair));
    }
  }

  return [...rules.values()].sort((a, b) => {
    if (a.from === b.from) return a.to.localeCompare(b.to);
    return a.from.localeCompare(b.from);
  });
}

export function serializeRedirectRules(rules: readonly RedirectRule[]): string {
  return `${rules.map((rule) => `${rule.from} ${rule.to} ${rule.status}`).join('\n')}\n`;
}

export function buildRedirectsPayload(
  pairs: readonly RedirectPair[] = enumerateRedirectPairs(),
  locales: readonly string[] = NON_ENGLISH_LOCALES,
): string {
  return serializeRedirectRules(buildRedirectRules(pairs, locales));
}

export async function writeRedirectsFile(outputPath = 'public/_redirects'): Promise<string> {
  const payload = buildRedirectsPayload();
  const resolvedOutput = path.resolve(process.cwd(), outputPath);
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  await writeFile(resolvedOutput, payload, 'utf8');
  return resolvedOutput;
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentModulePath = fileURLToPath(import.meta.url);

if (entrypointPath === currentModulePath) {
  const outputPath = process.argv[2] ?? 'public/_redirects';
  const written = await writeRedirectsFile(outputPath);
  console.log(`Wrote ${written}`);
}
