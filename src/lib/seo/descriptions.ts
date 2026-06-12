import type { Text } from '../db';
import type { LangCode } from '../reading-modes';
import { getTextSeoOverrides } from './corpus-overrides';
import * as as_ from './description-templates/as';
import * as bn from './description-templates/bn';
import * as en from './description-templates/en';
import * as gu from './description-templates/gu';
import * as hi from './description-templates/hi';
import * as kn from './description-templates/kn';
import * as ml from './description-templates/ml';
import * as mr from './description-templates/mr';
import * as or_ from './description-templates/or';
import * as pa from './description-templates/pa';
import * as ta from './description-templates/ta';
import * as te from './description-templates/te';

const TEMPLATES: Record<LangCode, typeof en> = {
  en,
  hi,
  ta,
  te,
  bn,
  mr,
  gu,
  kn,
  ml,
  pa,
  or: or_,
  as: as_,
};

/**
 * Back-compat shim — old callers used the English default directly. Prefer
 * `resolveTextDescription({ lang, ... })` so the right native template runs.
 */
export function buildDefaultTextDescription(input: { text: Text; totalVerses: number }): string {
  return en.buildTextDescriptionTemplate(input);
}

export function resolveTextDescription(input: {
  lang: LangCode;
  text: Text;
  totalVerses: number;
}): string {
  const override = getTextSeoOverrides(input.text.slug, input.lang).description;
  if (override) return override;
  const tmpl = TEMPLATES[input.lang] ?? TEMPLATES.en;
  return tmpl.buildTextDescriptionTemplate({ text: input.text, totalVerses: input.totalVerses });
}

export function resolveVerseDescription(input: {
  lang: LangCode;
  text: Text;
  chapter: number;
  verseNum: number;
  translation: string | null;
}): string | null {
  const tmpl = TEMPLATES[input.lang] ?? TEMPLATES.en;
  return tmpl.buildVerseDescriptionTemplate({
    text: input.text,
    chapter: input.chapter,
    verseNum: input.verseNum,
    translation: input.translation,
  });
}
