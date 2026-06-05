import type { Text } from '../../db';

/**
 * Assamese (Bengali-script) description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} শ্লোক, শব্দে-শব্দে অসমীয়া অনুবাদ। ${input.text.tradition} পৰম্পৰা।`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (অসমীয়া অনুবাদ)।`;
}
