import type { Text } from '../../db';

/**
 * Telugu description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} సంస్కృత శ్లోకాలు, పదాల వారీగా తెలుగు అనువాదంతో. ${input.text.tradition} పరంపర.`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (తెలుగు అనువాదం).`;
}
