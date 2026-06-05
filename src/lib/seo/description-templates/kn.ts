import type { Text } from '../../db';

/**
 * Kannada description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} ಸಂಸ್ಕೃತ ಶ್ಲೋಕಗಳು, ಪದದಿಂದ ಪದಕ್ಕೆ ಕನ್ನಡ ಅನುವಾದದೊಂದಿಗೆ. ${input.text.tradition} ಸಂಪ್ರದಾಯ.`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (ಕನ್ನಡ ಅನುವಾದ).`;
}
