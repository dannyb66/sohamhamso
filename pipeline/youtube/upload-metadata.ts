/**
 * pipeline/youtube/upload-metadata.ts
 *
 * Pure builder for the YouTube `videos.insert` metadata body. Bakes in the
 * non-negotiable attribution chain (CC-BY-SA 4.0 + Muktabodha/source) and a
 * UTM-tagged canonical backlink (the whole point of the pipeline — drive
 * link-clicks to sohamhamso.org). Title is truncated to keep titles short.
 *
 * Pure — no imports. Unit-tested + snapshot-tested separately.
 */

export interface UploadMetadataArgs {
  textTitle: string;
  chapter: number;
  verseNum: number;
  lang: string;
  translation: string;
  canonicalUrl: string;
  /** IAST transliteration (e.g. "caitanyam ātmā") — a strong Sanskrit search term. */
  iast?: string;
  /** Devanāgarī of the Sanskrit verse (searchable + adds on-page keywords). */
  devanagari?: string;
  tags?: string[];
  license?: string;
}

export interface UploadMetadata {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    defaultLanguage: string;
    defaultAudioLanguage: string;
  };
  status: {
    privacyStatus: 'unlisted';
    license: string;
    selfDeclaredMadeForKids: false;
  };
}

/** Max chars of translation text allowed in the title tail. */
const TITLE_TRANSLATION_MAX = 60;

/** Truncate to ~max chars on a word boundary where possible, adding an ellipsis. */
function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const head = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return `${head.trimEnd()}…`;
}

/** ASCII, space-free hashtag token from a title (e.g. "Śiva Sūtra" → "ShivaSutra"). */
function hashtagize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^A-Za-z0-9]/g, '');
}

/**
 * Build SEO-optimized, attribution-bearing upload metadata for one video.
 *
 * Description is structured for YouTube search/Shorts discovery: the translation
 * is front-loaded (first lines weigh most), followed by the searchable IAST +
 * Devanāgarī, a keyword-rich one-liner, the UTM canonical CTA, a subscribe CTA,
 * a tight hashtag set (<15 so YouTube honors them), and the licence/attribution
 * footer. Tags broaden algorithmic reach.
 */
export function buildUploadMetadata(a: UploadMetadataArgs): UploadMetadata {
  const utmUrl = `${a.canonicalUrl}?utm_source=youtube&utm_medium=short&utm_campaign=verse`;
  const ref = `${a.textTitle} ${a.chapter}.${a.verseNum}`;
  const title = `${ref} — ${truncate(a.translation, TITLE_TRANSLATION_MAX)}`;

  const hashtags = [
    '#Shorts',
    '#KashmirShaivism',
    '#Shaivism',
    '#Trika',
    '#Sanskrit',
    '#Spirituality',
    '#Meditation',
    '#Advaita',
    '#Nonduality',
  ];
  const tag = hashtagize(a.textTitle);
  if (tag) hashtags.push(`#${tag}`);

  // Searchable Sanskrit block (IAST quoted + Devanāgarī), omitted if absent.
  const sanskrit = [a.iast?.trim() ? `“${a.iast.trim()}”` : '', a.devanagari?.trim() ?? '']
    .filter(Boolean)
    .join('\n');

  const description = [
    a.translation.trim(),
    sanskrit,
    `${ref} — a verse from the ${a.textTitle}, a foundational text of Kashmir Śaivism (Trika / Pratyabhijñā). Ancient Sanskrit wisdom on consciousness (cit), Śiva, and the Self (ātman).`,
    `📖 Read, listen & study every verse in 11 languages → ${utmUrl}\n🔔 Subscribe for a new verse each day.`,
    hashtags.join(' '),
    'License: CC-BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0). Source text & translation via Muktabodha Indological Research Institute and sohamhamso.org. Translation AI-assisted, human-reviewed.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const tags = [
    'Kashmir Shaivism',
    'Trika',
    'Pratyabhijna',
    'Shaivism',
    'Sanskrit',
    'Spanda',
    'Shiva Sutras',
    'Advaita',
    'nonduality',
    'meditation',
    'spirituality',
    'Indian philosophy',
    'Hindu philosophy',
    a.textTitle,
    ...(a.tags ?? []),
  ];

  return {
    snippet: {
      title,
      description,
      tags,
      defaultLanguage: a.lang,
      defaultAudioLanguage: a.lang,
    },
    status: {
      privacyStatus: 'unlisted',
      license: a.license ?? 'creativeCommon',
      selfDeclaredMadeForKids: false,
    },
  };
}
