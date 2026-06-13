/**
 * sohamhamso — morph trust-audit comparison logic (pure functions)
 *
 * Compares Vidyut-cheda output (data/morph/{slug}.json, produced by
 * pipeline/morph/runner.py) against the LLM-authored `word_glosses` already
 * in the corpus YAML. Lemma-level agreement/disagreement per gloss word is
 * the trust audit input — see pipeline/morph/README.md.
 *
 * Everything in this module is deterministic and dependency-free so it can
 * be unit-tested with fixtures (no Vidyut install required).
 *
 * IMPORTANT framing: disagreement does NOT mean the LLM gloss is wrong.
 * vidyut-cheda is experimental and visibly struggles on terse sūtra text
 * and tantric proper nouns absent from its kosha. The audit is a triage
 * queue for human review, not a verdict.
 */

// ---------------------------------------------------------------------------
// Transliteration + normalization
// ---------------------------------------------------------------------------

/** Ordered IAST -> SLP1 replacements (multi-char first; order matters). */
const IAST_TO_SLP1: ReadonlyArray<readonly [string, string]> = [
  ['ai', 'E'],
  ['au', 'O'],
  ['kh', 'K'],
  ['gh', 'G'],
  ['ch', 'C'],
  ['jh', 'J'],
  ['ṭh', 'W'],
  ['ḍh', 'Q'],
  ['th', 'T'],
  ['dh', 'D'],
  ['ph', 'P'],
  ['bh', 'B'],
  ['ā', 'A'],
  ['ī', 'I'],
  ['ū', 'U'],
  ['ṝ', 'F'],
  ['ṛ', 'f'],
  ['ḹ', 'X'],
  ['ḷ', 'x'],
  ['ṅ', 'N'],
  ['ñ', 'Y'],
  ['ṭ', 'w'],
  ['ḍ', 'q'],
  ['ṇ', 'R'],
  ['ś', 'S'],
  ['ṣ', 'z'],
  ['ṃ', 'M'],
  ['ṁ', 'M'],
  ['ḥ', 'H'],
  ['ē', 'e'],
  ['ō', 'o'],
];

/** Deterministic IAST -> SLP1 transliteration (NFC-normalized, lowercased). */
export function iastToSlp1(text: string): string {
  let s = text.normalize('NFC').toLowerCase();
  for (const [src, dst] of IAST_TO_SLP1) {
    s = s.split(src).join(dst);
  }
  return s;
}

const SLP1_CHARS = new Set('aAiIuUfFxXeEoOMHkKgGNcCjJYwWqQRtTdDnpPbBmyrlvSzsh'.split(''));

/**
 * Normalize one SLP1 word for comparison:
 *  - strip everything outside the SLP1 alphabet (daṇḍas, avagraha, hyphens,
 *    digits, whitespace)
 *  - resolve final-position visarga sandhi variants: trailing H -> s
 *    (vidyut emits the pre-visarga `s`: rAmas, not rAmaH)
 *  - trailing anusvāra M -> m (vanaM ~ vanam)
 */
export function normalizeSlp1(word: string): string {
  let s = '';
  for (const ch of word) {
    if (SLP1_CHARS.has(ch)) s += ch;
  }
  if (s.endsWith('H')) s = `${s.slice(0, -1)}s`;
  if (s.endsWith('M')) s = `${s.slice(0, -1)}m`;
  return s;
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export interface MorphToken {
  surface: string;
  lemma: string | null;
  lemma_iast?: string | null;
  mw_headword_candidate?: string | null;
  pos?: string | null;
  tags?: Record<string, string | null> | null;
}

export type WordClassification =
  | 'match' // one vidyut token, surface identical to the gloss word
  | 'split' // gloss word covered by 2+ vidyut tokens exactly
  | 'merged' // a single vidyut token spans this word and a neighbor
  | 'split_crossing' // token boundaries straddle the word boundary
  | 'mismatch' // aligned region differs (sandhi resolution diverged)
  | 'unmatched'; // no vidyut tokens left to align

export interface AlignedWord {
  /** normalized SLP1 form of the gloss word */
  word: string;
  classification: WordClassification;
  /** indices into the token array for the tokens aligned to this word */
  tokenIndices: number[];
  /** lemma-level agreement (see lemmaAgrees) */
  lemmaAgreement: boolean;
}

export interface VerseAlignment {
  mode: 'exact-span' | 'greedy';
  words: AlignedWord[];
}

function lemmaAgrees(
  word: string,
  classification: WordClassification,
  tokens: MorphToken[],
  tokenIndices: number[],
): boolean {
  if (classification === 'match') return true;
  if (tokenIndices.length !== 1) return false;
  const tok = tokens[tokenIndices[0]];
  const lemma = tok.lemma ? normalizeSlp1(tok.lemma) : '';
  if (!lemma) return false;
  if (word === lemma) return true;
  // stem match: the gloss word is an inflection of the vidyut lemma and the
  // lemma covers at least half of the word (guards against 1-2 char stems
  // "matching" everything).
  return word.startsWith(lemma) && lemma.length * 2 >= word.length;
}

/**
 * Align normalized gloss words against vidyut tokens for one verse.
 *
 * When the concatenated normalized gloss words equal the concatenated
 * normalized token surfaces, alignment is exact via character spans.
 * Otherwise (sandhi resolution diverged) a greedy two-pointer fallback with
 * bounded lookahead is used and the verse is flagged `mode: 'greedy'`.
 */
export function alignVerse(glossWords: string[], tokens: MorphToken[]): VerseAlignment {
  const words = glossWords.map(normalizeSlp1).filter((w) => w.length > 0);
  const surfaces = tokens.map((t) => normalizeSlp1(t.surface));

  const G = words.join('');
  const T = surfaces.join('');

  if (G === T && G.length > 0) {
    return { mode: 'exact-span', words: alignBySpans(words, surfaces, tokens) };
  }
  return { mode: 'greedy', words: alignGreedy(words, surfaces, tokens) };
}

function alignBySpans(words: string[], surfaces: string[], tokens: MorphToken[]): AlignedWord[] {
  // word spans
  const wordSpans: Array<[number, number]> = [];
  let pos = 0;
  for (const w of words) {
    wordSpans.push([pos, pos + w.length]);
    pos += w.length;
  }
  // token spans
  const tokenSpans: Array<[number, number]> = [];
  pos = 0;
  for (const s of surfaces) {
    tokenSpans.push([pos, pos + s.length]);
    pos += s.length;
  }

  return words.map((w, i) => {
    const [ws, we] = wordSpans[i];
    const tokenIndices: number[] = [];
    for (let j = 0; j < tokenSpans.length; j++) {
      const [ts, te] = tokenSpans[j];
      if (ts < we && te > ws) tokenIndices.push(j);
    }
    let classification: WordClassification;
    if (tokenIndices.length === 0) {
      classification = 'unmatched';
    } else if (tokenIndices.length === 1) {
      const [ts, te] = tokenSpans[tokenIndices[0]];
      classification = ts === ws && te === we ? 'match' : 'merged';
    } else {
      const [fs] = tokenSpans[tokenIndices[0]];
      const [, le] = tokenSpans[tokenIndices[tokenIndices.length - 1]];
      classification = fs === ws && le === we ? 'split' : 'split_crossing';
    }
    return {
      word: w,
      classification,
      tokenIndices,
      lemmaAgreement: lemmaAgrees(w, classification, tokens, tokenIndices),
    };
  });
}

const GREEDY_LOOKAHEAD = 6;

function alignGreedy(words: string[], surfaces: string[], tokens: MorphToken[]): AlignedWord[] {
  const out: AlignedWord[] = [];
  let j = 0; // token cursor
  for (const w of words) {
    // exact: smallest run of consecutive tokens concatenating to the word
    let consumed = 0;
    let acc = '';
    let exactK = -1;
    for (let k = 0; k < GREEDY_LOOKAHEAD && j + k < surfaces.length; k++) {
      acc += surfaces[j + k];
      if (acc === w) {
        exactK = k + 1;
        break;
      }
      if (acc.length > w.length) break;
    }
    if (exactK > 0) {
      const tokenIndices = Array.from({ length: exactK }, (_, k) => j + k);
      const classification: WordClassification = exactK === 1 ? 'match' : 'split';
      out.push({
        word: w,
        classification,
        tokenIndices,
        lemmaAgreement: lemmaAgrees(w, classification, tokens, tokenIndices),
      });
      j += exactK;
      continue;
    }
    // no exact cover: consume tokens until we have at least the word's
    // length of material (sandhi diverged), classify as mismatch
    acc = '';
    const tokenIndices: number[] = [];
    while (j < surfaces.length && acc.length < w.length && consumed < GREEDY_LOOKAHEAD) {
      acc += surfaces[j];
      tokenIndices.push(j);
      j += 1;
      consumed += 1;
    }
    const classification: WordClassification = tokenIndices.length === 0 ? 'unmatched' : 'mismatch';
    out.push({
      word: w,
      classification,
      tokenIndices,
      lemmaAgreement: lemmaAgrees(w, classification, tokens, tokenIndices),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Audit construction
// ---------------------------------------------------------------------------

export interface CorpusWordGloss {
  word?: string;
  iast?: string;
  word_idx?: number;
  gloss_en?: string;
  morph?: string;
}

export interface CorpusVerse {
  ref: string;
  word_glosses: CorpusWordGloss[];
}

export interface MorphVerse {
  ref: string;
  input: string;
  input_source?: string;
  tokens: MorphToken[];
}

export interface AuditWordRow {
  word_idx: number;
  word: string; // as written in the corpus (IAST preferred)
  word_slp1: string;
  llm_gloss_en: string | null;
  llm_morph: string | null;
  vidyut_tokens: MorphToken[];
  classification: WordClassification;
  lemma_agreement: boolean;
}

export interface AuditVerse {
  ref: string;
  alignment_mode: 'exact-span' | 'greedy';
  words: AuditWordRow[];
}

export interface AuditSummary {
  verses_compared: number;
  verses_without_morph: number;
  verses_without_glosses: number;
  words_total: number;
  lemma_agree: number;
  lemma_disagree: number;
  agreement_rate: number;
  classifications: Record<WordClassification, number>;
}

export interface Audit {
  text_slug: string;
  summary: AuditSummary;
  verses: AuditVerse[];
}

const EMPTY_CLASSIFICATIONS = (): Record<WordClassification, number> => ({
  match: 0,
  split: 0,
  merged: 0,
  split_crossing: 0,
  mismatch: 0,
  unmatched: 0,
});

/**
 * Build the trust audit for one text: lemma-level agreement between Vidyut
 * output and the LLM word_glosses already in the corpus.
 */
export function buildAudit(
  textSlug: string,
  corpusVerses: CorpusVerse[],
  morphVerses: Map<string, MorphVerse>,
): Audit {
  const verses: AuditVerse[] = [];
  let versesWithoutMorph = 0;
  let versesWithoutGlosses = 0;
  const classifications = EMPTY_CLASSIFICATIONS();
  let wordsTotal = 0;
  let agree = 0;

  for (const cv of corpusVerses) {
    const glosses = (cv.word_glosses ?? []).filter((g) => g && (g.iast || g.word));
    if (glosses.length === 0) {
      versesWithoutGlosses += 1;
      continue;
    }
    const mv = morphVerses.get(cv.ref);
    if (!mv) {
      versesWithoutMorph += 1;
      continue;
    }

    const glossSurfaces = glosses.map((g) => (g.iast ?? g.word) as string);
    const glossSlp1 = glossSurfaces.map((s) => iastToSlp1(s));
    const alignment = alignVerse(glossSlp1, mv.tokens);

    // alignVerse drops empty-after-normalization words; rebuild the mapping
    const normalized = glossSlp1.map(normalizeSlp1);
    const keptIdx: number[] = [];
    normalized.forEach((w, i) => {
      if (w.length > 0) keptIdx.push(i);
    });

    const words: AuditWordRow[] = alignment.words.map((aw, k) => {
      const gi = keptIdx[k];
      const g = glosses[gi];
      classifications[aw.classification] += 1;
      wordsTotal += 1;
      if (aw.lemmaAgreement) agree += 1;
      return {
        word_idx: typeof g.word_idx === 'number' ? g.word_idx : gi,
        word: glossSurfaces[gi],
        word_slp1: aw.word,
        llm_gloss_en: g.gloss_en ?? null,
        llm_morph: g.morph ?? null,
        vidyut_tokens: aw.tokenIndices.map((j) => mv.tokens[j]),
        classification: aw.classification,
        lemma_agreement: aw.lemmaAgreement,
      };
    });

    verses.push({ ref: cv.ref, alignment_mode: alignment.mode, words });
  }

  return {
    text_slug: textSlug,
    summary: {
      verses_compared: verses.length,
      verses_without_morph: versesWithoutMorph,
      verses_without_glosses: versesWithoutGlosses,
      words_total: wordsTotal,
      lemma_agree: agree,
      lemma_disagree: wordsTotal - agree,
      agreement_rate: wordsTotal === 0 ? 0 : Math.round((agree / wordsTotal) * 10000) / 10000,
      classifications,
    },
    verses,
  };
}
