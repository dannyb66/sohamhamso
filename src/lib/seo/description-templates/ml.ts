import type { Text } from '../../db';

/**
 * Malayalam description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} സംസ്കൃത ശ്ലോകങ്ങൾ, വാക്കിന് വാക്കായി മലയാള പരിഭാഷയോടെ. ${input.text.tradition} പരമ്പര.`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (മലയാള പരിഭാഷ).`;
}
