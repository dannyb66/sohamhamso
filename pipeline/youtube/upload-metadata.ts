/**
 * pipeline/youtube/upload-metadata.ts
 *
 * Pure builder for the YouTube `videos.insert` metadata body. Bakes in the
 * non-negotiable attribution chain (CC-BY-SA 4.0 + Muktabodha/source) and a
 * UTM-tagged canonical backlink (the whole point of the pipeline — drive
 * link-clicks to sohamhamso.org). Title is truncated to keep titles short.
 *
 * Pure (aside from per-language chrome) — unit-tested + snapshot-tested separately.
 */
import {
  hasLocalizedChapterMeta,
  localizedChapterKeywordSentence,
  localizedChapterTitle,
} from './chapter-i18n';

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
  /**
   * Native-script text title (Devanāgarī `title_sa`), used as the in-language
   * keyword in localized (non-en) titles/descriptions. Falls back to `textTitle`
   * (IAST/Latin) when absent. Ignored for `lang==='en'`.
   */
  textTitleDevanagari?: string;
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
  /**
   * Max verses folded into one YouTube chapter marker (`chapters.group_max_verses`,
   * default 1). Short sutras are grouped so every marker spans ≥10s — YouTube
   * ignores ALL chapters otherwise. Long verses still stand alone.
   */
  groupMaxVerses?: number;
  tags?: string[];
  license?: string;
}

/** YouTube requires every chapter to be ≥10s long, the first at 0:00. */
const MIN_MARKER_GAP_S = 10;

/**
 * Group ordered per-verse segments into YouTube chapter-marker lines, each
 * ≥10s after the previous marker (else YouTube drops every chapter). Walks
 * verses greedily: a marker opens at a verse, then absorbs following verses
 * until the span reaches MIN_MARKER_GAP_S OR `groupMaxVerses` is hit. Verses
 * that can't reach 10s even at the cap fold into the running marker so no
 * timestamp ever lands <10s apart. Label: "Verse N" or "Verses N–M".
 */
export function buildChapterMarkerLines(
  ordered: ChapterTimestampSegment[],
  groupMaxVerses: number,
): Array<{ startS: number; firstVerse: number; lastVerse: number }> {
  const cap = Math.max(1, Math.floor(groupMaxVerses));
  const markers: Array<{ startS: number; firstVerse: number; lastVerse: number }> = [];
  // The 0:00 title is always the first chapter; seed with it so the first verse
  // marker lands ≥10s in (leading short verses fold under the opening chapter).
  let lastMarkerS = 0;
  let i = 0;
  while (i < ordered.length) {
    const start = ordered[i];
    let k = i;
    // Grow until the NEXT verse would sit ≥10s past this marker, or cap hit.
    while (
      k + 1 < ordered.length &&
      k - i + 1 < cap &&
      ordered[k + 1].startS - start.startS < MIN_MARKER_GAP_S
    ) {
      k++;
    }
    if (start.startS - lastMarkerS < MIN_MARKER_GAP_S) {
      // Too close to the previous marker: fold these verses into it (or, for
      // the opening, under the 0:00 title) rather than emit a <10s timestamp.
      const prev = markers[markers.length - 1];
      if (prev) prev.lastVerse = ordered[k].verseNum;
    } else {
      markers.push({
        startS: start.startS,
        firstVerse: start.verseNum,
        lastVerse: ordered[k].verseNum,
      });
      lastMarkerS = start.startS;
    }
    i = k + 1;
  }
  return markers;
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

  // Per-language SEO localization — each non-en channel must rank in its own
  // language's search. EN keeps the legacy byte-identical path below.
  const localized = hasLocalizedChapterMeta(a.lang);
  // Native text title (Devanāgarī `title_sa` if supplied, else the IAST/Latin
  // title) — the strongest in-language keyword for the localized title/tag.
  const nativeTitle = a.textTitleDevanagari?.trim() ? a.textTitleDevanagari.trim() : a.textTitle;

  // Title: localized → in-language keyword in the first ~40 chars, e.g. hi →
  // "शिवसूत्र अध्याय 1 — सभी 22 श्लोक". EN → "{textTitle} — Chapter {N} | All
  // {count} Verses", singular-safe (spanda ch4 → "… | Verse 1"), ≤100 chars.
  let title: string;
  if (localized) {
    title = truncate(localizedChapterTitle(a.lang, nativeTitle, a.chapter, a.verseCount), TITLE_MAX);
  } else {
    const verseLabel = a.verseCount === 1 ? 'Verse 1' : `All ${a.verseCount} Verses`;
    const titleSuffix = ` — Chapter ${a.chapter} | ${verseLabel}`;
    title = `${truncate(a.textTitle, Math.max(8, TITLE_MAX - titleSuffix.length))}${titleSuffix}`;
  }

  // Timestamp block: 0:00 title line, grouped verse markers (≥10s apart),
  // outro last. Verses are folded ≤groupMaxVerses per marker so YouTube
  // accepts the chapter list (every chapter must be ≥10s).
  const ordered = [...a.segments].sort((x, y) => x.startS - y.startS);
  const markers = buildChapterMarkerLines(ordered, a.groupMaxVerses ?? 1);
  // Verses that fold under the 0:00 opening chapter (they start <10s in) are
  // named on the title line so the chapter list accounts for every verse.
  const firstMarked = markers[0]?.firstVerse;
  const openingCover =
    firstMarked && ordered.length > 0 && firstMarked > ordered[0].verseNum
      ? ` · Verses ${ordered[0].verseNum}–${firstMarked - 1}`
      : '';
  const timestampLines = [
    `0:00 ${a.textTitle} — Chapter ${a.chapter}${openingCover}`,
    ...markers.map((m) => {
      const label =
        m.firstVerse === m.lastVerse
          ? `Verse ${m.firstVerse}`
          : `Verses ${m.firstVerse}–${m.lastVerse}`;
      return `${formatTimestamp(m.startS)} ${label}`;
    }),
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

  // Keyword context line: localized → leads with the in-language keyword,
  // reusing the site SEO template's native clause. EN → unchanged legacy line.
  const keywordLine = localized
    ? localizedChapterKeywordSentence(a.lang, nativeTitle, a.chapter, a.verseCount, a.tradition)
    : `${a.textTitle} — Chapter ${a.chapter}: ${verseCountPhrase} with Devanāgarī, IAST and English translation, from a foundational text of Kashmir Śaivism (Trika / Pratyabhijñā). Ancient Sanskrit wisdom on consciousness (cit), Śiva, and the Self (ātman).`;

  const description = [
    a.summary.trim(),
    sanskrit,
    keywordLine,
    `📖 Read this chapter verse by verse, with glosses, in 11 languages → ${utmUrl}\n🔔 Subscribe for a new verse each day.`,
    timestampLines,
    hashtags.join(' '),
    'License: CC-BY-SA 4.0 (creativecommons.org/licenses/by-sa/4.0). Source text & translation via Muktabodha Indological Research Institute and sohamhamso.org. Translation AI-assisted, human-reviewed.',
  ]
    .filter(Boolean)
    .join('\n\n');

  // First tag = the exact in-language target keyword (the dominant SEO lever for
  // the per-language channel), then the broad English topic tags (still help).
  // EN: unchanged — no leading localized tag.
  const localizedKeywordTag = localized
    ? localizedChapterTitle(a.lang, nativeTitle, a.chapter, a.verseCount)
    : null;
  const tags = [
    ...(localizedKeywordTag ? [localizedKeywordTag] : []),
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
