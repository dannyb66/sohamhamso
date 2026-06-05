import type { Text } from '../../db';

/**
 * Hindi (Devanāgarī) description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} श्लोक, संस्कृत मूल और शब्द-दर-शब्द हिन्दी अनुवाद। ${input.text.tradition} परम्परा।`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (हिन्दी अनुवाद)।`;
}
