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

/** YouTube's hard title limit. */
const TITLE_MAX = 100;

/**
 * Strip `<` and `>` — YouTube rejects angle brackets in titles and
 * descriptions (videos.insert fails with invalidTitle/invalidDescription).
 * Single shared chokepoint for BOTH builders.
 */
function sanitizeForYoutube(s: string): string {
  return s.replace(/[<>]/g, '');
}

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
      title: sanitizeForYoutube(title),
      description: sanitizeForYoutube(description),
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

// ─────────────────────────────────────────────────────────────────────────────
// Chapter videos (format 2 — 16:9 full-chapter uploads)
// ─────────────────────────────────────────────────────────────────────────────

/** One per-verse timestamp from the render sidecar (`.meta.json`). */
export interface ChapterTimestampSegment {
  verseNum: number;
  /** Segment start in seconds from video start. */
  startS: number;
}

export interface ChapterUploadMetadataArgs {
  textTitle: string;
  chapter: number;
  /** Verses in the chapter — drives singular/plural title grammar. */
  verseCount: number;
  lang: string;
  /** Canonical chapter-page URL segments: sohamhamso.org/{tradition}/{textSlug}/{chapter} (no trailing slash) */
  tradition: string;
  textSlug: string;
  /** Front-loaded one-line chapter summary (first description lines weigh most). */
  summary: string;
  /** IAST of the chapter's opening verse — a strong Sanskrit search term. */
  iast?: string;
  /** Devanāgarī of the chapter's opening verse (searchable). */
  devanagari?: string;
  /** Per-verse timestamps from the sidecar. MUST be non-empty (throws otherwise). */
  segments: ChapterTimestampSegment[];
  /** Start of the outro card in seconds — the final timestamp line. */
  outroStartS: number;
  tags?: string[];
  license?: string;
}

/** `M:SS` under an hour, `H:MM:SS` above (YouTube chapter-timestamp format). */
function formatTimestamp(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Build SEO-optimized, attribution-bearing upload metadata for one CHAPTER
 * video, following the same house style as `buildUploadMetadata`: front-loaded
 * summary, searchable IAST + Devanāgarī, keyword context line, UTM canonical
 * CTA + subscribe CTA, timestamp block (YouTube chapters), tight hashtag set
 * (<15, NO #Shorts — this is a long-form 16:9 video), licence/attribution
 * footer, broad tags.
 *
 * Timestamp contract: `0:00 {title}` first, one `M:SS Verse N` per sidecar
 * segment, and an outro line last — always ≥3 lines (YouTube's chapter
 * minimum), even for a 1-verse chapter. Throws if `segments` is empty:
 * never publish a chapter video without timestamps.
 */
export function buildChapterUploadMetadata(a: ChapterUploadMetadataArgs): UploadMetadata {
  if (a.segments.length === 0) {
    throw new Error(
      'buildChapterUploadMetadata: segments must be non-empty — never upload a chapter video without timestamps',
    );
  }

  // Canonical CHAPTER-PAGE URL — tradition segment is part of the route
  // (src/pages/[lang]/[tradition]/[text]/[chapter]/). NO trailing slash: the
  // site sets trailingSlash:'never' + build.format:'file', so the canonical
  // form is bare.
  const canonicalUrl = `https://sohamhamso.org/${a.tradition}/${a.textSlug}/${a.chapter}`;
  const utmUrl = `${canonicalUrl}?utm_source=youtube&utm_medium=chapter&utm_campaign=chapter`;

  // Title: "{textTitle} — Chapter {N} | All {count} Verses", singular-safe
  // (spanda-karikas ch4 has exactly 1 verse → "… | Verse 1"). ≤100 chars.
  const verseLabel = a.verseCount === 1 ? 'Verse 1' : `All ${a.verseCount} Verses`;
  const titleSuffix = ` — Chapter ${a.chapter} | ${verseLabel}`;
  const title = `${truncate(a.textTitle, Math.max(8, TITLE_MAX - titleSuffix.length))}${titleSuffix}`;

  // Timestamp block: 0:00 title line, then one line per verse, outro last.
  const ordered = [...a.segments].sort((x, y) => x.startS - y.startS);
  const timestampLines = [
    `0:00 ${a.textTitle} — Chapter ${a.chapter}`,
    ...ordered.map((s) => `${formatTimestamp(s.startS)} Verse ${s.verseNum}`),
    `${formatTimestamp(a.outroStartS)} Read the full chapter — sohamhamso.org`,
  ].join('\n');

  // Hashtags: house style (≤15 so YouTube honors them), NO #Shorts.
  const hashtags = [
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

  // Searchable Sanskrit block (opening verse), omitted if absent.
  const sanskrit = [a.iast?.trim() ? `“${a.iast.trim()}”` : '', a.devanagari?.trim() ?? '']
    .filter(Boolean)
    .join('\n');

  const verseCountPhrase = a.verseCount === 1 ? 'its single verse' : `all ${a.verseCount} verses`;

  const description = [
    a.summary.trim(),
    sanskrit,
    `${a.textTitle} — Chapter ${a.chapter}: ${verseCountPhrase} with Devanāgarī, IAST and English translation, from a foundational text of Kashmir Śaivism (Trika / Pratyabhijñā). Ancient Sanskrit wisdom on consciousness (cit), Śiva, and the Self (ātman).`,
    `📖 Read this chapter verse by verse, with glosses, in 11 languages → ${utmUrl}\n🔔 Subscribe for a new verse each day.`,
    timestampLines,
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
    'full chapter',
    a.textTitle,
    ...(a.tags ?? []),
  ];

  return {
    snippet: {
      title: sanitizeForYoutube(title),
      description: sanitizeForYoutube(description),
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
