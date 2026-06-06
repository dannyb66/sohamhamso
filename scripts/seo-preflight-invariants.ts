#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import { parseCorpusDocument } from '../src/lib/seo/corpus-schema';
import { liveLocaleSet } from '../src/lib/seo/i18n-routes';
import type { LangCode } from '../src/lib/reading-modes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PreflightFailure {
  file: string;
  kind: 'noindex_lang' | 'missing_translation';
  lang: LangCode;
  /** Present only for missing_translation failures */
  verse?: string;
}

export interface PreflightResult {
  failures: PreflightFailure[];
  textCount: number;
  verseCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCorpusSourceFile(name: string): boolean {
  return /\.(ya?ml)$/i.test(name) && !/\.faq\.ya?ml$/i.test(name) && !name.startsWith('_');
}

function hasTranslationForLang(
  translations: Array<{ lang?: string; text?: string | null; translation_text?: string | null }> | undefined,
  lang: LangCode,
): boolean {
  if (!translations) return false;
  return translations.some(
    (t) =>
      t.lang === lang &&
      (typeof t.text === 'string' && t.text.trim().length > 0 ||
        typeof t.translation_text === 'string' && t.translation_text.trim().length > 0),
  );
}

// ---------------------------------------------------------------------------
// Core logic (exported for tests)
// ---------------------------------------------------------------------------

export function runPreflightChecks(options: {
  corpusDir: string;
  liveLocales: Set<LangCode>;
}): PreflightResult {
  const { corpusDir, liveLocales } = options;
  const failures: PreflightFailure[] = [];
  let textCount = 0;
  let verseCount = 0;

  // Non-English live locales are the only ones that can lack translations
  // (en is the canonical source language) and the only ones noindex_langs can list.
  const liveNonEnglish = [...liveLocales].filter((l): l is Exclude<LangCode, 'en'> => l !== 'en');

  if (!existsSync(corpusDir)) {
    throw new Error(`Corpus directory not found: ${corpusDir}`);
  }

  for (const name of readdirSync(corpusDir).sort()) {
    if (!isCorpusSourceFile(name)) continue;

    const filePath = resolve(corpusDir, name);
    const raw = readFileSync(filePath, 'utf8');
    const parsed = yamlLoad(raw);
    const document = parseCorpusDocument(parsed);

    textCount += 1;

    // --- Invariant 1: noindex_langs must not intersect live locales ----------
    const noindexLangs = new Set(document.seo?.noindex_langs ?? []);
    for (const lang of liveNonEnglish) {
      if (noindexLangs.has(lang)) {
        failures.push({ file: name, kind: 'noindex_lang', lang });
      }
    }

    // --- Invariant 2: every live non-English locale must have a translation ---
    for (const chapter of document.chapters) {
      for (const verse of chapter.verses) {
        verseCount += 1;
        const verseId = `chapter ${chapter.chapter}, verse ${verse.verse ?? verse.verse_num}`;

        for (const lang of liveNonEnglish) {
          if (!hasTranslationForLang(verse.translations, lang)) {
            failures.push({ file: name, kind: 'missing_translation', lang, verse: verseId });
          }
        }
      }
    }
  }

  return { failures, textCount, verseCount };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const corpusDir = resolve(process.cwd(), 'data', 'corpus');
  const liveLocales = liveLocaleSet();

  const { failures, textCount, verseCount } = runPreflightChecks({ corpusDir, liveLocales });

  const liveNonEnglishCount = [...liveLocales].filter((l) => l !== 'en').length;

  if (failures.length > 0) {
    console.error(JSON.stringify(failures, null, 2));
    console.error(
      `Preflight: FAIL — ${failures.length} invariant violation(s) across ${textCount} texts, ${verseCount} verses`,
    );
    process.exit(1);
  }

  console.log(
    `Preflight: PASS — ${textCount} texts, ${verseCount} verses × ${liveNonEnglishCount} locales verified`,
  );
}

main();
