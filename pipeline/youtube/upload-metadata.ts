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

/** Build localized, attribution-bearing upload metadata for one video. */
export function buildUploadMetadata(a: UploadMetadataArgs): UploadMetadata {
  const utmUrl = `${a.canonicalUrl}?utm_source=youtube&utm_medium=short&utm_campaign=verse`;
  const title = `${a.textTitle} ${a.chapter}.${a.verseNum} — ${truncate(
    a.translation,
    TITLE_TRANSLATION_MAX,
  )}`;

  const description = [
    a.translation.trim(),
    '',
    `Read & study this verse: ${utmUrl}`,
    '',
    'License: CC-BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).',
    'Source text & translation via Muktabodha Indological Research Institute and sohamhamso.org. Translation AI-assisted, human-reviewed.',
  ].join('\n');

  const tags = ['Kashmir Shaivism', 'Trika', 'Sanskrit', a.textTitle, ...(a.tags ?? [])];

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
