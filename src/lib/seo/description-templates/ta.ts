import type { Text } from '../../db';

/**
 * Tamil description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} சம்ஸ்க்ருதச் சுலோகங்கள், சொல்லுக்குச் சொல் தமிழ் மொழிபெயர்ப்புடன். ${input.text.tradition} மரபு.`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (தமிழ் மொழிபெயர்ப்பு).`;
}
