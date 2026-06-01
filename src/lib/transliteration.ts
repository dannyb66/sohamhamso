/**
 * Thin wrapper around `@indic-transliteration/sanscript`.
 *
 * Centralises the (small) set of scripts sohamhamso supports so the rest
 * of the codebase doesn't have to know which scheme names map to which
 * Brahmic/Roman alphabets. Also gives one chokepoint for input validation
 * and (later) for the `data-sa-source` lossless-roundtrip pattern.
 */

// biome-ignore lint/correctness/noUndeclaredDependencies: package ships its
// own types via the CommonJS entrypoint.
import Sanscript from '@indic-transliteration/sanscript';

/**
 * The eleven scripts the reader UI surfaces. IAST is the Roman target;
 * the other ten are Brahmic scripts of the subcontinent. Devanāgarī is
 * the canonical source script for the corpus.
 */
export const availableScripts: readonly string[] = [
  'devanagari',
  'bengali',
  'gujarati',
  'gurmukhi',
  'kannada',
  'malayalam',
  'oriya',
  'tamil',
  'telugu',
  'iast',
  'assamese',
] as const;

/**
 * Convert `text` from `fromScript` to `toScript`. Throws on an unsupported
 * scheme name (anything not in `availableScripts`) so typos surface loudly
 * rather than returning a silently-wrong transliteration.
 */
export function toScript(text: string, fromScript: string, toScript: string): string {
  if (!availableScripts.includes(fromScript)) {
    throw new Error(
      `Unsupported source script: '${fromScript}'. Supported: ${availableScripts.join(', ')}`,
    );
  }
  if (!availableScripts.includes(toScript)) {
    throw new Error(
      `Unsupported target script: '${toScript}'. Supported: ${availableScripts.join(', ')}`,
    );
  }
  return Sanscript.t(text, fromScript, toScript);
}
