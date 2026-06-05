import type { Text } from '../../db';

/**
 * Odia description template. Native copy — NOT machine-translated.
 */
export function buildTextDescriptionTemplate(input: {
  text: Text;
  totalVerses: number;
}): string {
  return `${input.text.title_en} — ${input.totalVerses} ସଂସ୍କୃତ ଶ୍ଳୋକ, ଶବ୍ଦ-ପ୍ରତି-ଶବ୍ଦ ଓଡ଼ିଆ ଅନୁବାଦ ସହିତ। ${input.text.tradition} ପରମ୍ପରା।`;
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
  return `${input.text.title_en} ${locator} — ${trimmed} (ଓଡ଼ିଆ ଅନୁବାଦ)।`;
}
