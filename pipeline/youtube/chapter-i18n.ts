/**
 * pipeline/youtube/chapter-i18n.ts
 *
 * Localized chrome strings for chapter videos: the title-card third line,
 * the footer "Verse i of M" slot, the outro footer reference, and the spoken
 * title narration. The words are taken verbatim from the site's authoritative
 * dictionary (src/i18n/<lang>.json — keys text_overview.table.chapter,
 * text_overview.verses_suffix, verse.number_aria_prefix) so we never machine-
 * translate scripture terms. Keep in sync if those site strings change.
 *
 * English formatters return the EXACT pre-localization strings, so the English
 * chapter videos render byte-identically (no re-render of the approved set).
 *
 * Pure data + string builders — safe to import into the Remotion bundle.
 */

export interface ChapterChrome {
  /** "Chapter" / "अध्याय" — title-card line + outro footer reference. */
  chapterWord: string;
  /** "Verse" (singular: footer slot, 1-verse card) / "श्लोक". */
  verseWord: string;
  /** "verses" (title-card plural) / "श्लोक". */
  versesWord: string;
}

// Sourced from src/i18n/<lang>.json (table.chapter / verses_suffix / verse.number_aria_prefix).
const CHROME: Record<string, ChapterChrome> = {
  en: { chapterWord: 'Chapter', verseWord: 'Verse', versesWord: 'verses' },
  hi: { chapterWord: 'अध्याय', verseWord: 'श्लोक', versesWord: 'श्लोक' },
  ta: { chapterWord: 'அத்தியாயம்', verseWord: 'சுலோகம்', versesWord: 'சுலோகங்கள்' },
  te: { chapterWord: 'అధ్యాయం', verseWord: 'శ్లోకం', versesWord: 'శ్లోకాలు' },
  kn: { chapterWord: 'ಅಧ್ಯಾಯ', verseWord: 'ಶ್ಲೋಕ', versesWord: 'ಶ್ಲೋಕಗಳು' },
  ml: { chapterWord: 'അധ്യായം', verseWord: 'ശ്ലോകം', versesWord: 'ശ്ലോകങ്ങൾ' },
  bn: { chapterWord: 'অধ্যায়', verseWord: 'শ্লোক', versesWord: 'শ্লোক' },
  mr: { chapterWord: 'अध्याय', verseWord: 'श्लोक', versesWord: 'श्लोक' },
  gu: { chapterWord: 'અધ્યાય', verseWord: 'શ્લોક', versesWord: 'શ્લોકો' },
  pa: { chapterWord: 'ਅਧਿਆਇ', verseWord: 'ਛੰਦ', versesWord: 'ਛੰਦ' },
};

/** Indic langs whose script is Devanāgarī, so a Devanāgarī title narrates cleanly. */
const DEVANAGARI_NARRATION = new Set(['hi', 'mr']);

/**
 * Per-language metadata chrome for YouTube CHAPTER uploads (title + description),
 * so each per-language channel ranks in its own language's search. Native copy
 * is REUSED verbatim from the site's authoritative SEO description templates
 * (src/lib/seo/description-templates/<lang>.ts — the same "… <verses> with
 * word-by-word <lang> translation. <tradition> tradition." phrasing) and the
 * site dictionary (src/i18n/<lang>.json — the "all" word for "all N verses").
 * We never machine-translate scripture terms; only languages with an authoritative
 * site template appear here. Unknown langs fall back to English text but STILL use
 * the in-language chapter/verse words from `chapterChrome(lang)`.
 */
interface ChapterMetaChrome {
  /** "all" — title verse-count phrase ("all 22 verses" / "सभी 22 श्लोक"). */
  allWord: string;
  /**
   * Native-language clause describing the per-verse offering, taken from the
   * site SEO template. Rendered after the verse count: e.g. hi →
   * "संस्कृत मूल और शब्द-दर-शब्द हिन्दी अनुवाद" → "… 22 श्लोक, संस्कृत मूल और …".
   */
  withTranslation: string;
  /** Native word for "tradition"/"lineage" (the SEO template's trailing noun). */
  traditionWord: string;
}

// Sourced from src/lib/seo/description-templates/<lang>.ts (the "<verses>, …
// <lang> translation. <tradition> tradition." copy) + src/i18n/<lang>.json
// (the "all" word). EN is intentionally absent — English uses its own legacy path.
const META_CHROME: Record<string, ChapterMetaChrome> = {
  hi: { allWord: 'सभी', withTranslation: 'संस्कृत मूल और शब्द-दर-शब्द हिन्दी अनुवाद', traditionWord: 'परम्परा' },
  ta: { allWord: 'அனைத்து', withTranslation: 'சொல்லுக்குச் சொல் தமிழ் மொழிபெயர்ப்புடன்', traditionWord: 'மரபு' },
  te: { allWord: 'అన్ని', withTranslation: 'పదాల వారీగా తెలుగు అనువాదంతో', traditionWord: 'పరంపర' },
  kn: { allWord: 'ಎಲ್ಲಾ', withTranslation: 'ಪದದಿಂದ ಪದಕ್ಕೆ ಕನ್ನಡ ಅನುವಾದದೊಂದಿಗೆ', traditionWord: 'ಸಂಪ್ರದಾಯ' },
  ml: { allWord: 'എല്ലാ', withTranslation: 'വാക്കിന് വാക്കായി മലയാള പരിഭാഷയോടെ', traditionWord: 'പരമ്പര' },
  bn: { allWord: 'সমস্ত', withTranslation: 'শব্দে শব্দে বাংলা অনুবাদ', traditionWord: 'পরম্পরা' },
  mr: { allWord: 'सर्व', withTranslation: 'शब्दशः मराठी अनुवाद', traditionWord: 'परंपरा' },
  gu: { allWord: 'બધા', withTranslation: 'શબ્દશઃ ગુજરાતી અનુવાદ', traditionWord: 'સંપ્રદાય' },
  pa: { allWord: 'ਸਾਰੇ', withTranslation: 'ਸ਼ਬਦ-ਦਰ-ਸ਼ਬਦ ਪੰਜਾਬੀ ਅਨੁਵਾਦ ਨਾਲ', traditionWord: 'ਪਰੰਪਰਾ' },
};

/** True when a non-English language has authoritative native metadata copy. */
export function hasLocalizedChapterMeta(lang: string): boolean {
  return lang !== 'en' && lang in META_CHROME && lang in CHROME;
}

/**
 * In-language CHAPTER title with the primary keyword in the first ~40 chars:
 * "{title} {chapterWord} {N} — {allWord} {count} {versesWord}", e.g.
 * hi → "शिवसूत्र अध्याय 1 — सभी 22 श्लोक". The title prefers the Devanāgarī/native
 * text title (a stronger in-language search term) and falls back to the IAST/Latin
 * title when none is supplied. Singular-safe (count===1 drops the "all" word).
 * Callers must guard with `hasLocalizedChapterMeta` — English keeps its own title.
 */
export function localizedChapterTitle(
  lang: string,
  textTitleNative: string,
  chapter: number,
  verseCount: number,
): string {
  const c = chapterChrome(lang);
  const m = META_CHROME[lang] ?? META_CHROME.hi;
  const verseWord = verseCount === 1 ? c.verseWord : c.versesWord;
  const count =
    verseCount === 1 ? `${verseCount}` : `${m.allWord} ${verseCount}`;
  return `${textTitleNative.trim()} ${c.chapterWord} ${chapter} — ${count} ${verseWord}`;
}

/**
 * In-language description keyword sentence (the searchable body), reusing the
 * site SEO template's native clause. Mirrors the English context line's shape
 * but leads with the in-language keyword:
 * "{title} {chapterWord} {N}: {count} {versesWord}, {withTranslation}. {tradition} {traditionWord}."
 * e.g. hi → "शिवसूत्र अध्याय 1: सभी 22 श्लोक, संस्कृत मूल और शब्द-दर-शब्द हिन्दी अनुवाद। Trika परम्परा।".
 */
export function localizedChapterKeywordSentence(
  lang: string,
  textTitleNative: string,
  chapter: number,
  verseCount: number,
  tradition: string,
): string {
  const c = chapterChrome(lang);
  const m = META_CHROME[lang] ?? META_CHROME.hi;
  const verseWord = verseCount === 1 ? c.verseWord : c.versesWord;
  const count = verseCount === 1 ? `${verseCount}` : `${m.allWord} ${verseCount}`;
  return `${textTitleNative.trim()} ${c.chapterWord} ${chapter}: ${count} ${verseWord}, ${m.withTranslation}. ${tradition} ${m.traditionWord}.`;
}

export function chapterChrome(lang: string): ChapterChrome {
  return CHROME[lang] ?? CHROME.en;
}

/** Title-card third line: "Chapter 1 · 22 verses" / "अध्याय 1 · 22 श्लोक". */
export function formatChapterCardLine(lang: string, chapter: number, verseCount: number): string {
  const c = chapterChrome(lang);
  const word = verseCount === 1 ? c.verseWord : c.versesWord;
  return `${c.chapterWord} ${chapter} · ${verseCount} ${word}`;
}

/** Footer right slot: "Verse 11 of 22" (en) / "श्लोक 11 / 22" (localized). */
export function formatVerseProgress(lang: string, index1: number, total: number): string {
  const c = chapterChrome(lang);
  return lang === 'en'
    ? `${c.verseWord} ${index1} of ${total}`
    : `${c.verseWord} ${index1} / ${total}`;
}

/** Outro footer reference: "Chapter 1" / "अध्याय 1". */
export function formatChapterRef(lang: string, chapter: number): string {
  return `${chapterChrome(lang).chapterWord} ${chapter}`;
}

/**
 * Spoken title-card narration. English keeps its full phrasing. Devanāgarī
 * langs (hi/mr) speak the Devanāgarī title + localized chapter word. Other
 * Indic langs announce the chapter only — their TTS cannot read the Devanāgarī
 * title and no per-lang transliterated title exists yet (tracked gap; the
 * title still appears on-screen).
 */
export function localizedTitleNarration(
  lang: string,
  titleIast: string,
  titleDevanagari: string,
  author: string | null | undefined,
  chapter: number,
): string {
  if (lang === 'en') {
    const of = author && author.trim() !== '' ? ` of ${author.trim()}` : '';
    return `The ${titleIast}${of}. Chapter ${chapter}.`;
  }
  const { chapterWord } = chapterChrome(lang);
  if (DEVANAGARI_NARRATION.has(lang)) {
    return `${titleDevanagari}. ${chapterWord} ${chapter}.`;
  }
  return `${chapterWord} ${chapter}.`;
}
