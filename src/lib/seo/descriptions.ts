import type { Text } from '../db';
import type { LangCode } from '../reading-modes';
import { getTextSeoOverrides } from './corpus-overrides';
import { buildTextDescriptionTemplate } from './description-templates/text';

export function buildDefaultTextDescription(input: { text: Text; totalVerses: number }): string {
  return buildTextDescriptionTemplate(input);
}

export function resolveTextDescription(input: {
  lang: LangCode;
  text: Text;
  totalVerses: number;
}): string {
  return (
    getTextSeoOverrides(input.text.slug, input.lang).description ??
    buildDefaultTextDescription({ text: input.text, totalVerses: input.totalVerses })
  );
}
