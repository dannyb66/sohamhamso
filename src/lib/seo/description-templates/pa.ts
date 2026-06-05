import type { Text } from '../../db';

/**
 * Punjabi (Gurmukhi) description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} ਸੰਸਕ੍ਰਿਤ ਸ਼ਲੋਕ, ਸ਼ਬਦ-ਦਰ-ਸ਼ਬਦ ਪੰਜਾਬੀ ਅਨੁਵਾਦ ਨਾਲ। ${input.text.tradition} ਪਰੰਪਰਾ।`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (ਪੰਜਾਬੀ ਅਨੁਵਾਦ)।`;
}
