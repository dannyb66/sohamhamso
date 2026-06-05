import type { Text } from '../db';
import type { LangCode } from '../reading-modes';
import { getTextSeoOverrides } from './corpus-overrides';

function dedupeKeywords(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

export function buildDefaultTextKeywords(input: { text: Text }): string[] {
  const { text } = input;
  return dedupeKeywords([
    text.title_en,
    text.title_iast,
    text.title_sa,
    text.tradition,
    text.school,
    text.author,
    'Sanskrit text',
    'Tantra',
    'sohamhamso',
  ]);
}

export function resolveTextKeywords(input: { lang: LangCode; text: Text }): string[] {
  return (
    getTextSeoOverrides(input.text.slug, input.lang).keywords ??
    buildDefaultTextKeywords({ text: input.text })
  );
}
