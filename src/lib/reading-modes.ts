/**
 * reading-modes — single source of truth for the unified "reading mode"
 * picker used across the site (Masthead language menu, ScriptSwitcher
 * on verse pages, SettingsSheet defaults).
 *
 * Design intent (locked, user spec 2026-06-01):
 *   - One catalogue, three pickers, identical rows + behavior.
 *   - Each row binds a language code (en/hi/mr/...) to a script id
 *     (devanagari/iast/bengali/...) so picking a row reconfigures BOTH
 *     the Sanskrit-line transliteration AND the gloss + translation
 *     language in one motion.
 *   - Hindi and Marathi both ride Devanāgarī but stay distinct rows
 *     because they're distinct reader languages.
 *
 * Persistence contract:
 *   - localStorage['sohamhamso:script']       = scriptId   (drives Sanscript)
 *   - localStorage['sohamhamso:reader-lang']  = langCode   (drives ReaderLangSwap)
 *   - document dispatches CustomEvent('sohamhamso:reader-lang-change',
 *     { detail: { lang } }) so islands can react without a reload.
 *
 * Availability:
 *   - `availableInDb` is hand-curated per the corpus state and used as a
 *     UI hint when a build-time DB check isn't trivial (the Masthead
 *     still defers to getAvailableLanguages() at build time and only
 *     uses this flag as a defensive default for SSR-less surfaces).
 */

/** Sanscript scheme id — the target script for `[data-sa]` transliteration. */
export type ScriptId =
  | 'devanagari'
  | 'iast'
  | 'bengali'
  | 'assamese'
  | 'gujarati'
  | 'gurmukhi'
  | 'kannada'
  | 'malayalam'
  | 'oriya'
  | 'tamil'
  | 'telugu';

/** ISO-ish reader language code matching the corpus translation keys. */
export type LangCode =
  | 'en'
  | 'hi'
  | 'mr'
  | 'bn'
  | 'as'
  | 'gu'
  | 'pa'
  | 'kn'
  | 'ml'
  | 'or'
  | 'ta'
  | 'te';

export interface ReadingMode {
  /** Reader language code — drives glosses + translation language. */
  langCode: LangCode;
  /** Sanscript script id — drives the [data-sa] transliteration target. */
  scriptId: ScriptId;
  /** Self-name in the target script (e.g. हिन्दी, বাংলা). */
  nativeLabel: string;
  /** English exonym (e.g. "Hindi", "Bengali"). */
  englishName: string;
  /** Best-effort flag: does the corpus DB carry content in this language? */
  availableInDb: boolean;
}

/**
 * The 12 reading modes, in canonical UI order.
 *
 * Order rationale: English first (the default fallback), then Hindi /
 * Marathi (Devanāgarī family), then Eastern Indic (Bengali, Assamese,
 * Odia ride the Bengali/Eastern cluster ordering loosely), then
 * Western Indic (Gujarati, Punjabi), then Dravidian (Kannada,
 * Malayalam, Tamil, Telugu). This matches the user spec table.
 */
export const READING_MODES: readonly ReadingMode[] = [
  {
    langCode: 'en',
    scriptId: 'iast',
    nativeLabel: 'English',
    englishName: 'English',
    availableInDb: true,
  },
  {
    langCode: 'hi',
    scriptId: 'devanagari',
    nativeLabel: 'हिन्दी',
    englishName: 'Hindi',
    availableInDb: true,
  },
  {
    langCode: 'mr',
    scriptId: 'devanagari',
    nativeLabel: 'मराठी',
    englishName: 'Marathi',
    availableInDb: true,
  },
  {
    langCode: 'bn',
    scriptId: 'bengali',
    nativeLabel: 'বাংলা',
    englishName: 'Bengali',
    availableInDb: true,
  },
  {
    langCode: 'as',
    scriptId: 'assamese',
    nativeLabel: 'অসমীয়া',
    englishName: 'Assamese',
    availableInDb: true,
  },
  {
    langCode: 'gu',
    scriptId: 'gujarati',
    nativeLabel: 'ગુજરાતી',
    englishName: 'Gujarati',
    availableInDb: true,
  },
  {
    langCode: 'pa',
    scriptId: 'gurmukhi',
    nativeLabel: 'ਪੰਜਾਬੀ',
    englishName: 'Punjabi',
    availableInDb: true,
  },
  {
    langCode: 'kn',
    scriptId: 'kannada',
    nativeLabel: 'ಕನ್ನಡ',
    englishName: 'Kannada',
    availableInDb: true,
  },
  {
    langCode: 'ml',
    scriptId: 'malayalam',
    nativeLabel: 'മലയാളം',
    englishName: 'Malayalam',
    availableInDb: true,
  },
  {
    langCode: 'or',
    scriptId: 'oriya',
    nativeLabel: 'ଓଡ଼ିଆ',
    englishName: 'Odia',
    availableInDb: true,
  },
  {
    langCode: 'ta',
    scriptId: 'tamil',
    nativeLabel: 'தமிழ்',
    englishName: 'Tamil',
    availableInDb: true,
  },
  {
    langCode: 'te',
    scriptId: 'telugu',
    nativeLabel: 'తెలుగు',
    englishName: 'Telugu',
    availableInDb: true,
  },
];

/** Lookup a reading mode by its language code. Returns undefined if unknown. */
export function getReadingModeByLang(lang: string): ReadingMode | undefined {
  return READING_MODES.find((r) => r.langCode === lang);
}

/**
 * Lookup the first reading mode whose scriptId matches.
 *
 * Note: Devanāgarī is ambiguous (Hindi + Marathi both ride it). This
 * helper returns the first match in catalogue order, so a stored
 * scriptId='devanagari' restore lands on Hindi. Callers that need to
 * disambiguate should use `getReadingModeByLang` keyed off the
 * persisted reader-lang instead.
 */
export function getReadingModeByScript(scriptId: string): ReadingMode | undefined {
  return READING_MODES.find((r) => r.scriptId === scriptId);
}

const SCRIPT_KEY = 'sohamhamso:script';
const READER_LANG_KEY = 'sohamhamso:reader-lang';

/**
 * Apply a reading-mode pick globally:
 *   1. Write both localStorage keys (script + reader-lang).
 *   2. Dispatch sohamhamso:reader-lang-change on `document` so any
 *      hydrated island (ReaderLangSwap, ScriptSwitcher's listener)
 *      reacts client-side without a page reload.
 *
 * Returns the matched ReadingMode (or undefined for an unknown lang
 * code, in which case nothing is written).
 */
export function applyReadingMode(langCode: string): ReadingMode | undefined {
  const mode = getReadingModeByLang(langCode);
  if (!mode) return undefined;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SCRIPT_KEY, mode.scriptId);
      localStorage.setItem(READER_LANG_KEY, mode.langCode);
    }
  } catch {
    /* localStorage unavailable — private mode, SSR — ignore */
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(
      new CustomEvent('sohamhamso:reader-lang-change', {
        detail: { lang: mode.langCode },
      }),
    );
  }
  return mode;
}
