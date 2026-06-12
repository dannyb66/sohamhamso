import { type LangCode, READING_MODES } from '@/lib/reading-modes';
import * as z from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export const CORPUS_SCHEMA_VERSION = 1 as const;
export const SEO_SCHEMA_VERSION = 1 as const;
export const FAQ_SCHEMA_VERSION = 1 as const;

export const KNOWN_TRADITIONS = ['trika', 'shakta', 'kaula', 'shaiva'] as const;
export const TRANSLATION_STATUSES = ['draft', 'reviewed', 'published'] as const;

export const CORPUS_LANG_CODES = READING_MODES.map((mode) => mode.langCode) as [
  LangCode,
  ...LangCode[],
];

export const NON_ENGLISH_CORPUS_LANG_CODES = READING_MODES.filter(
  (mode) => mode.langCode !== 'en',
).map((mode) => mode.langCode) as [Exclude<LangCode, 'en'>, ...Exclude<LangCode, 'en'>[]];

const NonEmptyString = z.string().trim().min(1);
const OptionalString = NonEmptyString.optional();
const NullableString = NonEmptyString.nullable().optional();
const OptionalUrl = z.string().trim().url().nullable().optional();
const OptionalBooleanFlag = z
  .union([z.boolean(), z.literal(0), z.literal(1)])
  .nullable()
  .optional();

function buildLanguageShape<T extends z.ZodTypeAny>(
  factory: () => T,
): Record<LangCode, z.ZodOptional<T>> {
  return Object.fromEntries(
    CORPUS_LANG_CODES.map((lang) => [lang, factory().optional()]),
  ) as Record<LangCode, z.ZodOptional<T>>;
}

type GlossFieldName = `gloss_${LangCode}`;

function buildGlossShape(): Record<GlossFieldName, typeof OptionalString> {
  return Object.fromEntries(
    CORPUS_LANG_CODES.map((lang) => [`gloss_${lang}`, OptionalString]),
  ) as Record<GlossFieldName, typeof OptionalString>;
}

export const CorpusLangCodeSchema = z.enum(CORPUS_LANG_CODES);
export const NonEnglishCorpusLangCodeSchema = z.enum(NON_ENGLISH_CORPUS_LANG_CODES);
export const CorpusTraditionSchema = z.enum(KNOWN_TRADITIONS);
export const TranslationStatusSchema = z.enum(TRANSLATION_STATUSES);

export const CorpusDescriptionOverridesSchema = z
  .object(buildLanguageShape(() => NonEmptyString))
  .strict()
  .default({});

export const CorpusKeywordOverridesSchema = z
  .object(buildLanguageShape(() => z.array(NonEmptyString).min(1)))
  .strict()
  .default({});

export const CorpusSeoSchema = z
  .object({
    schema_version: z.literal(SEO_SCHEMA_VERSION).default(SEO_SCHEMA_VERSION),
    descriptions: CorpusDescriptionOverridesSchema,
    keywords: CorpusKeywordOverridesSchema,
    noindex_langs: z.array(NonEnglishCorpusLangCodeSchema).default([]),
  })
  .strict();

export const CorpusFaqLocalizedTextSchema = z
  .object(buildLanguageShape(() => NonEmptyString))
  .strict();

function normalizeLocalizedText(
  value: string | Partial<Record<LangCode, string | undefined>>,
): Partial<Record<LangCode, string>> {
  if (typeof value === 'string') return { en: value };
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [LangCode, string] => {
      return typeof entry[1] === 'string' && entry[1].trim().length > 0;
    }),
  ) as Partial<Record<LangCode, string>>;
}

export const CorpusFaqEntrySchema = z
  .object({
    question: z.union([NonEmptyString, CorpusFaqLocalizedTextSchema]),
    answer: z.union([NonEmptyString, CorpusFaqLocalizedTextSchema]),
  })
  .strict()
  .transform((parsed) => ({
    answer: normalizeLocalizedText(parsed.answer),
    question: normalizeLocalizedText(parsed.question),
  }));

export const CorpusFaqDocumentSchema = z
  .object({
    schema_version: z.literal(FAQ_SCHEMA_VERSION).default(FAQ_SCHEMA_VERSION),
    faqs: z.array(CorpusFaqEntrySchema).min(1),
  })
  .strict();

export const CorpusWordGlossSchema = z
  .object({
    word_idx: z.number().int().nonnegative().optional(),
    word: OptionalString,
    word_sa: OptionalString,
    iast: OptionalString,
    lemma_sa: NullableString,
    lemma_iast: NullableString,
    gloss_lang: OptionalString,
    gloss: OptionalString,
    gloss_text: OptionalString,
    morph: NullableString,
    ...buildGlossShape(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.word && !value.word_sa) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "word_glosses entries require 'word' or 'word_sa'",
        path: ['word'],
      });
    }

    const hasLanguageGloss = CORPUS_LANG_CODES.some((lang) => {
      const key = `gloss_${lang}` as keyof typeof value;
      const glossValue = value[key];
      return typeof glossValue === 'string' && glossValue.trim().length > 0;
    });

    if (!value.gloss && !value.gloss_text && !hasLanguageGloss) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "word_glosses entries require at least one of 'gloss', 'gloss_text', or 'gloss_{lang}'",
        path: ['gloss_text'],
      });
    }
  });

export const CorpusTranslationSchema = z
  .object({
    lang: CorpusLangCodeSchema.default('en'),
    translator: NullableString,
    translation_text: OptionalString,
    text: OptionalString,
    source: NullableString,
    license: NonEmptyString.default('PD'),
    status: TranslationStatusSchema.default('published'),
    ai_assisted: OptionalBooleanFlag,
    model: NullableString,
    model_version: NullableString,
    prompt_version: NullableString,
    judge_score: z.number().finite().nullable().optional(),
    reviewer: NullableString,
    reviewed_at: NullableString,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.translation_text && !value.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "translations entries require 'text' or 'translation_text'",
        path: ['text'],
      });
    }
  });

export const CorpusVerseSchema = z
  .object({
    verse: z.number().int().positive().optional(),
    verse_num: z.number().int().positive().optional(),
    book: z.number().int().positive().nullable().optional(),
    devanagari: NonEmptyString,
    slp1: NullableString,
    iast: NullableString,
    meter: NullableString,
    manuscript_folio_ref: NullableString,
    word_glosses: z.array(CorpusWordGlossSchema).optional(),
    translations: z.array(CorpusTranslationSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verse === undefined && value.verse_num === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "verse entries require 'verse' or 'verse_num'",
        path: ['verse'],
      });
    }
  });

export const CorpusChapterSchema = z
  .object({
    chapter: z.number().int().positive(),
    title_sa: OptionalString,
    title_iast: OptionalString,
    title_en: OptionalString,
    verses: z.array(CorpusVerseSchema).min(1),
  })
  .strict();

export const CorpusTextMetadataSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title_sa: NonEmptyString,
    title_en: NonEmptyString,
    title_iast: NullableString,
    author: NullableString,
    tradition: CorpusTraditionSchema,
    school: NullableString,
    era: NullableString,
    source: NullableString,
    source_url: OptionalUrl,
    source_revision: NullableString,
    license: NonEmptyString,
    // CONTRACT: attribution_html is third-party-sourced raw HTML. It must
    // NEVER be rendered with `set:html` (or otherwise injected unescaped)
    // without sanitization — treat it as hostile until sanitized.
    attribution_html: NullableString,
    parent_text_id: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .nullable()
      .optional(),
    manuscript_url: OptionalUrl,
    description: NullableString,
    pending_miri: z.boolean().optional(),
    expected_verse_count: z.number().int().positive().optional(),
  })
  .strict();

export const CorpusDocumentSchema = z
  .object({
    schema_version: z.literal(CORPUS_SCHEMA_VERSION).default(CORPUS_SCHEMA_VERSION),
    faq_file: z
      .string()
      .trim()
      .regex(/^\.\//)
      .regex(/\.faq\.ya?ml$/)
      .optional(),
    seo: CorpusSeoSchema.optional(),
    text: CorpusTextMetadataSchema,
    chapters: z.array(CorpusChapterSchema).min(1),
  })
  .strict();

export const FlatCorpusDocumentSchema = z
  .object({
    schema_version: z.literal(CORPUS_SCHEMA_VERSION).default(CORPUS_SCHEMA_VERSION),
    faq_file: z
      .string()
      .trim()
      .regex(/^\.\//)
      .regex(/\.faq\.ya?ml$/)
      .optional(),
    seo: CorpusSeoSchema.optional(),
    ...CorpusTextMetadataSchema.shape,
    chapters: z.array(CorpusChapterSchema).min(1),
  })
  .strict();

export const CorpusDocumentInputSchema = z.union([CorpusDocumentSchema, FlatCorpusDocumentSchema]);

export type CorpusSeo = z.infer<typeof CorpusSeoSchema>;
export type CorpusWordGloss = z.infer<typeof CorpusWordGlossSchema>;
export type CorpusTranslation = z.infer<typeof CorpusTranslationSchema>;
export type CorpusVerse = z.infer<typeof CorpusVerseSchema>;
export type CorpusChapter = z.infer<typeof CorpusChapterSchema>;
export type CorpusTextMetadata = z.infer<typeof CorpusTextMetadataSchema>;
export type CorpusDocument = z.infer<typeof CorpusDocumentSchema>;
export type CorpusDocumentInput = z.input<typeof CorpusDocumentInputSchema>;
export type CorpusFaqEntry = z.infer<typeof CorpusFaqEntrySchema>;
export type CorpusFaqDocument = z.infer<typeof CorpusFaqDocumentSchema>;

export function createDefaultSeoConfig(): CorpusSeo {
  return CorpusSeoSchema.parse({});
}

export function normalizeCorpusDocument(input: unknown): CorpusDocument {
  const parsed = CorpusDocumentInputSchema.parse(input);

  if ('text' in parsed) {
    return {
      schema_version: parsed.schema_version,
      faq_file: parsed.faq_file,
      seo: parsed.seo ?? createDefaultSeoConfig(),
      text: parsed.text,
      chapters: parsed.chapters,
    };
  }

  const { schema_version, faq_file, seo, chapters, ...text } = parsed;

  return {
    schema_version,
    faq_file,
    seo: seo ?? createDefaultSeoConfig(),
    text: CorpusTextMetadataSchema.parse(text),
    chapters,
  };
}

export function parseCorpusDocument(input: unknown): CorpusDocument {
  return normalizeCorpusDocument(input);
}

export function parseCorpusFaqDocument(input: unknown): CorpusFaqDocument {
  return CorpusFaqDocumentSchema.parse(input);
}

export const corpusDocumentJsonSchema = zodToJsonSchema(CorpusDocumentSchema, {
  name: 'SohamhamsoCorpusDocument',
  target: 'jsonSchema7',
  $refStrategy: 'root',
});

export const corpusFaqDocumentJsonSchema = zodToJsonSchema(CorpusFaqDocumentSchema, {
  name: 'SohamhamsoCorpusFaqDocument',
  target: 'jsonSchema7',
  $refStrategy: 'root',
});
