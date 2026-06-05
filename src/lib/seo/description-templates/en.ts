import type { Text } from '../../db';

/**
 * English description template.
 *
 * Returns native English copy for the text-overview page and verse pages.
 * Each language template owns its own copy — DO NOT machine-translate
 * across locales. Stay under 160 chars when possible (metadata.ts will
 * truncate, but we want the truncation never to bite).
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  if (input.text.description) return input.text.description;
  return `${input.text.title_en} — ${input.totalVerses} verses with word-by-word translation. ${input.text.tradition} tradition.`;
}

export function buildVerseDescriptionTemplate(input: {
  text: Text;
  chapter: number;
  verseNum: number;
  translation: string | null;
}): string | null {
  if (input.translation === null) return null;
  const locator = `${input.chapter}.${input.verseNum}`;
  const trimmed = input.translation.replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${input.text.title_en} ${locator} — ${trimmed} (English translation).`;
}
