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
 * CALIBRATION (v2, 2026-06): raw lemma-string agreement undercounted badly
 * because most "disagreements" were methodological, not semantic:
 *
 *  1. ALIGNMENT — vidyut-cheda sandhi-splits surface words that the YAML
 *     word_glosses keep whole (and vice versa). A gloss word now maps to a
 *     SET of contiguous Vidyut padas via character-level alignment of the
 *     normalized concatenations (exact spans when they agree, Levenshtein
 *     DP with traceback when sandhi resolution diverges). A gloss counts as
 *     agreeing if ANY aligned pada's lemma matches one of the gloss word's
 *     hyphen/space-separated parts (or the whole word) after normalization.
 *  2. NORMALIZATION — a lemma normalizer covers the systematic convention
 *     gaps: SLP1<->IAST transliteration, visarga/anusvāra variants
 *     (-aḥ ~ -as ~ -a, -ṃ ~ -m), final-vowel nominal-stem variants
 *     (-am/-a, -ā/-an, -e/-a, -au/-i, vowel-length), and a guarded
 *     stem-prefix rule. Dhātu (root) lemmas vs derived stems are FLAGGED,
 *     never force-matched. Comparison is case-insensitive at IAST intake
 *     and diacritic-exact throughout (SLP1 space).
 *  3. CATEGORIES — every remaining disagreement is classified:
 *     llm_gloss_error / vidyut_segmentation / legitimate_ambiguity /
 *     unresolved_alignment (deterministic heuristics, documented below).
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

/**
 * SLP1 -> IAST (one code point per SLP1 letter, so a simple char map).
 * Mirrors the convention `pipeline/ingest/ingest.ts` uses via
 * `@indic-transliteration/sanscript` (cross-checked in the unit tests);
 * kept dependency-free here so compare.ts stays pure.
 */
const SLP1_TO_IAST: Readonly<Record<string, string>> = {
  A: 'ā',
  I: 'ī',
  U: 'ū',
  f: 'ṛ',
  F: 'ṝ',
  x: 'ḷ',
  X: 'ḹ',
  E: 'ai',
  O: 'au',
  M: 'ṃ',
  H: 'ḥ',
  K: 'kh',
  G: 'gh',
  N: 'ṅ',
  C: 'ch',
  J: 'jh',
  Y: 'ñ',
  w: 'ṭ',
  W: 'ṭh',
  q: 'ḍ',
  Q: 'ḍh',
  R: 'ṇ',
  T: 'th',
  D: 'dh',
  P: 'ph',
  B: 'bh',
  S: 'ś',
  z: 'ṣ',
};

export function slp1ToIast(text: string): string {
  let out = '';
  for (const ch of text) out += SLP1_TO_IAST[ch] ?? ch;
  return out;
}

const SLP1_CHARS = new Set('aAiIuUfFxXeEoOMHkKgGNcCjJYwWqQRtTdDnpPbBmyrlvSzsh'.split(''));

/**
 * Normalize one SLP1 word for comparison:
 *  - strip everything outside the SLP1 alphabet (daṇḍas, avagraha, hyphens,
 *    digits, whitespace)
 *  - resolve final-position visarga sandhi variants: trailing H -> s
 *    (vidyut emits the pre-visarga `s`: rAmas, not rAmaH)
 *  - trailing anusvāra M -> m (vanaM ~ vanam)
 *  - fold anusvāra/class-nasal spelling variants before stops to anusvāra
 *    (SaNkara ~ SaMkara, sanDAna ~ saMDAna): pure orthography, same word
 */
export function normalizeSlp1(word: string): string {
  let s = '';
  for (const ch of word) {
    if (SLP1_CHARS.has(ch)) s += ch;
  }
  if (s.endsWith('H')) s = `${s.slice(0, -1)}s`;
  if (s.endsWith('M')) s = `${s.slice(0, -1)}m`;
  s = s
    .replace(/[NM](?=[kKgG])/g, 'M')
    .replace(/[YM](?=[cCjJ])/g, 'M')
    .replace(/[RM](?=[wWqQ])/g, 'M')
    .replace(/[nM](?=[tTdD])/g, 'M')
    .replace(/[mM](?=[pPbB])/g, 'M');
  return s;
}

// ---------------------------------------------------------------------------
// Lemma normalizer (the calibration ladder)
// ---------------------------------------------------------------------------

export type LemmaMatchKind = 'exact' | 'variant' | 'stem';

/** Final long<->short vowel equivalences (vaDu ~ vaDU, devI ~ devi). */
const VOWEL_PAIRS: Readonly<Record<string, string>> = {
  a: 'A',
  A: 'a',
  i: 'I',
  I: 'i',
  u: 'U',
  U: 'u',
};

/**
 * Candidate nominal stems for an inflected gloss word part (SLP1, already
 * through normalizeSlp1 so final visarga is `s` and final anusvāra is `m`).
 * Covers the systematic ending conventions: -as/-a, -am/-a, -A/-an, -A/-a,
 * -e/-a (loc.), -O/-a|-i|-u (dual/loc.), -At/-a (abl.), common oblique
 * endings. Deliberately conservative: only well-known paradigm endings.
 */
function stemVariants(p: string): Set<string> {
  const v = new Set<string>([p]);
  if (p.length < 3) return v;
  const last = p[p.length - 1];
  if (last === 's' || last === 'm') v.add(p.slice(0, -1));
  if (last === 'A') {
    v.add(`${p.slice(0, -1)}a`);
    v.add(`${p.slice(0, -1)}an`);
  }
  if (last === 'O') {
    v.add(`${p.slice(0, -1)}a`);
    v.add(`${p.slice(0, -1)}i`);
    v.add(`${p.slice(0, -1)}u`);
  }
  if (last === 'e') v.add(`${p.slice(0, -1)}a`);
  if (last === 'I') v.add(`${p.slice(0, -1)}i`);
  if (p.endsWith('At')) v.add(`${p.slice(0, -2)}a`);
  if (p.endsWith('ena')) v.add(`${p.slice(0, -3)}a`);
  if (p.endsWith('asya')) v.add(`${p.slice(0, -4)}a`);
  if (p.endsWith('Aya')) v.add(`${p.slice(0, -3)}a`);
  if (p.endsWith('ayA')) v.add(`${p.slice(0, -3)}A`);
  if (p.endsWith('AByAm')) v.add(`${p.slice(0, -5)}a`);
  if (p.endsWith('AnAm')) v.add(`${p.slice(0, -4)}a`);
  if (p.endsWith('ezu')) v.add(`${p.slice(0, -3)}a`);
  return v;
}

/**
 * Suppletive pronominal paradigms (SLP1): inflected form -> acceptable
 * lemmas. Pronoun obliques share no stem with their lemma (tezAm ~ tad),
 * so string rules can never bridge them — this is a systematic convention
 * gap, not a disagreement. Forms shared across paradigms list every lemma.
 */
const PRONOUN_FORMS: Readonly<Record<string, readonly string[]>> = {
  // tad
  sas: ['tad'],
  sA: ['tad'],
  tat: ['tad'],
  tam: ['tad'],
  tAm: ['tad'],
  tO: ['tad'],
  tAni: ['tad'],
  tasya: ['tad'],
  tasyAs: ['tad'],
  tasmE: ['tad'],
  tasmAt: ['tad'],
  tasmin: ['tad'],
  tasyAm: ['tad'],
  tena: ['tad'],
  tayA: ['tad'],
  tezAm: ['tad'],
  tAsAm: ['tad'],
  tEs: ['tad'],
  tABis: ['tad'],
  tezu: ['tad'],
  tAsu: ['tad'],
  te: ['tad', 'yuzmad'],
  // etad
  ezas: ['etad'],
  ezA: ['etad'],
  etat: ['etad'],
  etam: ['etad'],
  etAm: ['etad'],
  etena: ['etad'],
  etayA: ['etad'],
  etasya: ['etad'],
  etasmin: ['etad'],
  etasyAm: ['etad'],
  ete: ['etad'],
  etAni: ['etad'],
  etezAm: ['etad'],
  // yad
  yas: ['yad'],
  yA: ['yad'],
  yat: ['yad'],
  yam: ['yad'],
  yAm: ['yad'],
  yena: ['yad'],
  yayA: ['yad'],
  yasya: ['yad'],
  yasyAs: ['yad'],
  yasmin: ['yad'],
  yasyAm: ['yad'],
  yasmAt: ['yad'],
  ye: ['yad'],
  yAni: ['yad'],
  yezAm: ['yad'],
  yAsAm: ['yad'],
  yezu: ['yad'],
  yEs: ['yad'],
  // kim
  kas: ['kim'],
  kA: ['kim'],
  kam: ['kim'],
  kena: ['kim'],
  kayA: ['kim'],
  kasya: ['kim'],
  kasmin: ['kim'],
  kasmAt: ['kim'],
  ke: ['kim'],
  kAni: ['kim'],
  // idam
  ayam: ['idam'],
  iyam: ['idam'],
  imam: ['idam'],
  imAm: ['idam'],
  anena: ['idam'],
  anayA: ['idam'],
  asya: ['idam'],
  asyAs: ['idam'],
  asmin: ['idam'],
  asyAm: ['idam'],
  asmAt: ['idam'],
  ime: ['idam'],
  imAs: ['idam'],
  imAni: ['idam'],
  eBis: ['idam'],
  ABis: ['idam'],
  ezAm: ['idam'],
  AsAm: ['idam'],
  ezu: ['idam'],
  Asu: ['idam'],
  asmE: ['idam'],
  // adas
  asO: ['adas'],
  amum: ['adas'],
  amunA: ['adas'],
  amuzya: ['adas'],
  amuzmin: ['adas'],
  amI: ['adas'],
  // asmad / yuzmad
  aham: ['asmad'],
  mAm: ['asmad'],
  mA: ['asmad'],
  mayA: ['asmad'],
  me: ['asmad'],
  mama: ['asmad'],
  mahyam: ['asmad'],
  mayi: ['asmad'],
  vayam: ['asmad'],
  nas: ['asmad'],
  asmAkam: ['asmad'],
  asmABis: ['asmad'],
  asmAsu: ['asmad'],
  tvam: ['yuzmad'],
  tvAm: ['yuzmad'],
  tvayA: ['yuzmad'],
  tvayi: ['yuzmad'],
  tava: ['yuzmad'],
  tuByam: ['yuzmad'],
  yUyam: ['yuzmad'],
  vas: ['yuzmad'],
  yuzmAkam: ['yuzmad'],
};

/**
 * Common indeclinables (SLP1). Used only for disagreement triage: when one
 * of these is the gloss word and vidyut still assigns a different lemma
 * (e.g. ayi -> e), we know the canonical lemma is the form itself, so the
 * divergence is a vidyut lexeme quirk, not a gloss error.
 */
const AVYAYA_FORMS: ReadonlySet<string> = new Set([
  'aTa',
  'adya',
  'antar',
  'atra',
  'api',
  'ayi',
  'aho',
  'iti',
  'itas',
  'iva',
  'iha',
  'eva',
  'evam',
  'aTavA',
  'kaTam',
  'kadA',
  'kadAcit',
  'kila',
  'kutra',
  'kutracit',
  'kvacit',
  'Kalu',
  'ca',
  'cet',
  'tatas',
  'tatra',
  'taTA',
  'tadA',
  'tarhi',
  'tu',
  'na',
  'nanu',
  'nUnam',
  'punar',
  'bahis',
  'mA',
  'yatas',
  'yatra',
  'yaTA',
  'yadA',
  'yadi',
  'vA',
  'vinA',
  'sadA',
  'saha',
  'svayam',
  'hi',
]);

/**
 * Does a (normalized SLP1) Vidyut lemma match a gloss word part?
 *  - 'exact'   — identical strings (allowed even for dhātu lemmas)
 *  - 'variant' — systematic ending/vowel-length convention difference
 *  - 'stem'    — guarded prefix rule: the part is an inflection of the
 *                lemma and the lemma covers >= half of the part
 *  - null      — no match. Dhātu (root) lemmas are never variant/stem
 *                force-matched against derived stems — they get flagged
 *                by the caller instead.
 */
export function lemmaMatchKind(
  part: string,
  lemmaNorm: string,
  isDhatu: boolean,
): LemmaMatchKind | null {
  if (!part || !lemmaNorm) return null;
  if (part === lemmaNorm) return 'exact';
  // suppletive pronominal paradigms (tezAm ~ tad): convention, not error
  if (PRONOUN_FORMS[part]?.includes(lemmaNorm)) return 'variant';
  if (isDhatu) return null; // flag, don't force-match
  if (stemVariants(part).has(lemmaNorm)) return 'variant';
  if (
    part.length >= 3 &&
    lemmaNorm.length >= 3 &&
    part.slice(0, -1) === lemmaNorm.slice(0, -1) &&
    VOWEL_PAIRS[part[part.length - 1]] === lemmaNorm[lemmaNorm.length - 1]
  ) {
    return 'variant';
  }
  // stem match: the part is an inflection of the vidyut lemma and the lemma
  // covers at least half of the part (guards against 1-2 char stems
  // "matching" everything).
  if (part.startsWith(lemmaNorm) && lemmaNorm.length * 2 >= part.length) return 'stem';
  return null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export interface MorphToken {
  surface: string;
  lemma: string | null;
  lemma_iast?: string | null;
  mw_headword_candidate?: string | null;
  pos?: string | null;
  tags?: Record<string, string | null> | null;
  /** full vidyut `repr(PadaEntry)` from runner.py (provenance) */
  entry?: string | null;
}

/**
 * Is the token's lemma a dhātu (verbal root) rather than a nominal stem?
 * True for tiṅantas and kṛdanta-derived subantas — vidyut lemmatizes both
 * to the root (e.g. saMhAras -> saMhf), which can never string-match the
 * derived stem in the gloss. These are flagged, not force-matched.
 */
function isDhatuToken(t: MorphToken): boolean {
  if (t.pos === 'tinanta') return true;
  return typeof t.entry === 'string' && t.entry.includes('DhatuEntry');
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export type WordClassification =
  | 'match' // one vidyut token, surface identical to the gloss word
  | 'split' // gloss word covered by 2+ vidyut tokens exactly
  | 'merged' // a single vidyut token spans this word and a neighbor
  | 'split_crossing' // token boundaries straddle the word boundary
  | 'mismatch' // aligned region differs (sandhi resolution diverged)
  | 'unmatched'; // no vidyut tokens left to align

export type DisagreementCategory =
  | 'llm_gloss_error' // (a) clean alignment, clean vidyut analysis, unrelated lemma
  | 'vidyut_segmentation' // (b) shredding / null lemmas / unsupported splits
  | 'legitimate_ambiguity' // (c) dhātu convention, alternative sandhi, related lexeme
  | 'unresolved_alignment'; // (d) alignment could not be established

export interface AlignedWord {
  /** normalized SLP1 form of the gloss word (parts concatenated) */
  word: string;
  /** hyphen/whitespace-separated parts of the gloss word, normalized */
  parts: string[];
  classification: WordClassification;
  /** indices into the token array for the tokens aligned to this word */
  tokenIndices: number[];
  /** lemma-level agreement: ANY aligned pada matched the word or a part */
  lemmaAgreement: boolean;
  /** strongest match found, when lemmaAgreement is true */
  matchKind: LemmaMatchKind | null;
  /** number of parts with at least one lemma-matching aligned pada */
  partsMatched: number;
  /** an aligned pada carries a dhātu lemma that was flagged, not matched */
  dhatuFlag: boolean;
  /** disagreement triage category (null when lemmaAgreement is true) */
  category: DisagreementCategory | null;
}

export interface VerseAlignment {
  mode: 'exact-span' | 'greedy';
  words: AlignedWord[];
}

/** Levenshtein distance (small strings only — per-word divergence checks). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * Character-level alignment of G (concatenated gloss words) against T
 * (concatenated token surfaces) via Levenshtein DP with traceback.
 * Returns pos[0..G.length]: for each G boundary, the corresponding T index
 * (monotone non-decreasing). Traceback prefers matched-char diagonals, then
 * T-insertions, then G-deletions, then substitutions — so shared material
 * anchors the mapping and divergent sandhi regions absorb the edits.
 */
function charAlignmentMap(G: string, T: string): number[] {
  const m = G.length;
  const n = T.length;
  const rows: Int32Array[] = [];
  for (let i = 0; i <= m; i++) rows.push(new Int32Array(n + 1));
  for (let j = 0; j <= n; j++) rows[0][j] = j;
  for (let i = 1; i <= m; i++) {
    rows[i][0] = i;
    const gi = G[i - 1];
    const prev = rows[i - 1];
    const cur = rows[i];
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (gi === T[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
  }
  const pos = new Array<number>(m + 1).fill(0);
  let i = m;
  let j = n;
  pos[m] = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && G[i - 1] === T[j - 1] && rows[i][j] === rows[i - 1][j - 1]) {
      i--;
      j--;
      pos[i] = j;
      continue;
    }
    if (j > 0 && rows[i][j] === rows[i][j - 1] + 1) {
      j--;
      pos[i] = j;
      continue;
    }
    if (i > 0 && rows[i][j] === rows[i - 1][j] + 1) {
      i--;
      pos[i] = j;
      continue;
    }
    // substitution
    i--;
    j--;
    pos[i] = j;
  }
  pos[0] = 0;
  // enforce monotonicity for any boundaries the path skipped
  for (let k = 1; k <= m; k++) if (pos[k] < pos[k - 1]) pos[k] = pos[k - 1];
  return pos;
}

interface Entry {
  parts: string[];
  norm: string;
}

/** whitespace plus the hyphen family (U+2010–U+2015, U+2212, ASCII '-') */
const PART_SEPARATOR = /[\s‐-―−-]+/u;

function toEntry(glossWord: string): Entry {
  const parts = glossWord
    .split(PART_SEPARATOR)
    .map(normalizeSlp1)
    .filter((p) => p.length > 0);
  return { parts, norm: parts.join('') };
}

/**
 * Align normalized gloss words against vidyut tokens for one verse.
 *
 * When the concatenated normalized gloss words equal the concatenated
 * normalized token surfaces, alignment is exact via character spans
 * (`mode: 'exact-span'`). Otherwise (sandhi resolution diverged) the spans
 * are projected through a character-level Levenshtein alignment and the
 * verse is flagged `mode: 'greedy'`.
 */
export function alignVerse(glossWords: string[], tokens: MorphToken[]): VerseAlignment {
  const entries = glossWords.map(toEntry).filter((e) => e.norm.length > 0);
  const surfaces = tokens.map((t) => normalizeSlp1(t.surface));

  const G = entries.map((e) => e.norm).join('');
  const T = surfaces.join('');

  const exact = G === T && G.length > 0;
  let pos: number[];
  if (exact) {
    pos = Array.from({ length: G.length + 1 }, (_, k) => k);
  } else {
    pos = charAlignmentMap(G, T);
  }

  // token spans over T
  const tokenSpans: Array<[number, number]> = [];
  {
    let p = 0;
    for (const s of surfaces) {
      tokenSpans.push([p, p + s.length]);
      p += s.length;
    }
  }

  const words: AlignedWord[] = [];
  let g = 0;
  for (const entry of entries) {
    const ws = g;
    const we = g + entry.norm.length;
    g = we;
    words.push(alignEntry(entry, ws, we, pos, T, tokens, surfaces, tokenSpans));
  }

  return { mode: exact ? 'exact-span' : 'greedy', words };
}

function tokensInRange(
  tokenSpans: Array<[number, number]>,
  ps: number,
  pe: number,
): number[] {
  const out: number[] = [];
  if (pe <= ps) return out;
  for (let j = 0; j < tokenSpans.length; j++) {
    const [ts, te] = tokenSpans[j];
    if (ts < pe && te > ps) out.push(j);
  }
  return out;
}

function alignEntry(
  entry: Entry,
  ws: number,
  we: number,
  pos: number[],
  T: string,
  tokens: MorphToken[],
  surfaces: string[],
  tokenSpans: Array<[number, number]>,
): AlignedWord {
  const ps = pos[ws];
  const pe = pos[we];
  const tokenIndices = tokensInRange(tokenSpans, ps, pe);

  // ---- classification (boundary geometry on projected spans) ----
  let classification: WordClassification;
  if (tokenIndices.length === 0) {
    classification = 'unmatched';
  } else {
    const [firstStart] = tokenSpans[tokenIndices[0]];
    const [, lastEnd] = tokenSpans[tokenIndices[tokenIndices.length - 1]];
    const boundsExact = firstStart === ps && lastEnd === pe;
    const cover = tokenIndices.map((j) => surfaces[j]).join('');
    if (boundsExact && cover === entry.norm) {
      classification = tokenIndices.length === 1 ? 'match' : 'split';
    } else if (boundsExact) {
      classification = 'mismatch';
    } else if (tokenIndices.length === 1) {
      classification = 'merged';
    } else {
      classification = 'split_crossing';
    }
  }

  // ---- per-part pada assignment ----
  const partInfos = entry.parts.map((part) => ({ part, padaIdxs: [] as number[] }));
  {
    let off = ws;
    for (const pi of partInfos) {
      const pps = pos[off];
      const ppe = pos[off + pi.part.length];
      pi.padaIdxs = tokensInRange(tokenSpans, pps, ppe);
      off += pi.part.length;
    }
  }

  // ---- lemma agreement: ANY aligned pada matching the whole word or its
  //      covering part, after normalization ----
  const KIND_RANK: Record<LemmaMatchKind, number> = { exact: 3, variant: 2, stem: 1 };
  let bestKind: LemmaMatchKind | null = null;
  let dhatuFlag = false;
  const lemmaNorms = new Map<number, string>();
  const dhatu = new Map<number, boolean>();
  for (const j of tokenIndices) {
    lemmaNorms.set(j, tokens[j].lemma ? normalizeSlp1(tokens[j].lemma as string) : '');
    dhatu.set(j, isDhatuToken(tokens[j]));
  }
  const consider = (kind: LemmaMatchKind | null) => {
    if (kind && (!bestKind || KIND_RANK[kind] > KIND_RANK[bestKind])) bestKind = kind;
  };
  let partsMatched = 0;
  for (const pi of partInfos) {
    let matched = false;
    for (const j of pi.padaIdxs) {
      const kind = lemmaMatchKind(pi.part, lemmaNorms.get(j) ?? '', dhatu.get(j) ?? false);
      consider(kind);
      if (kind) matched = true;
      else if (dhatu.get(j)) dhatuFlag = true;
    }
    if (matched) partsMatched += 1;
  }
  // whole-word check too (covers vidyut keeping a compound whole that the
  // gloss also keeps whole but parts diverge, and single-part entries)
  if (entry.parts.length > 1) {
    for (const j of tokenIndices) {
      consider(lemmaMatchKind(entry.norm, lemmaNorms.get(j) ?? '', dhatu.get(j) ?? false));
    }
  }
  const lemmaAgreement = bestKind !== null;

  // ---- disagreement category ----
  let category: DisagreementCategory | null = null;
  if (!lemmaAgreement) {
    category = categorize(entry, classification, tokenIndices, partInfos, lemmaNorms, dhatu, {
      slice: T.slice(ps, pe),
      surfaces,
    });
  }

  return {
    word: entry.norm,
    parts: entry.parts,
    classification,
    tokenIndices,
    lemmaAgreement,
    matchKind: bestKind,
    partsMatched,
    dhatuFlag,
    category,
  };
}

/**
 * Deterministic triage heuristics for disagreements, in priority order.
 * These are HEURISTICS for the human-review queue, not verdicts:
 *  (d) unresolved_alignment — no padas / straddling boundaries / >50% char
 *      divergence between the gloss word and its aligned region.
 *  (b) vidyut_segmentation — any null lemma; shredding (>=3 padas on one
 *      part, or average pada surface < 2.5 chars); or vidyut split a unit
 *      the gloss keeps whole with no lemma support for any piece.
 *  (c) legitimate_ambiguity — a dhātu-lemma pada is aligned (root vs
 *      derived-stem convention); or the surfaces diverge (the two tools
 *      resolved sandhi differently, both possibly valid); or a clean pada's
 *      lemma is lexically related (>=2-char common prefix).
 *  (a) llm_gloss_error — alignment exact, single clean non-dhātu pada,
 *      lemma unrelated to the gloss word: the strongest available signal
 *      that the gloss-side analysis is off.
 */
function categorize(
  entry: Entry,
  classification: WordClassification,
  tokenIndices: number[],
  partInfos: Array<{ part: string; padaIdxs: number[] }>,
  lemmaNorms: Map<number, string>,
  dhatu: Map<number, boolean>,
  ctx: { slice: string; surfaces: string[] },
): DisagreementCategory {
  if (classification === 'unmatched') return 'unresolved_alignment';
  for (const j of tokenIndices) {
    if (!lemmaNorms.get(j)) return 'vidyut_segmentation';
  }
  if (classification === 'split_crossing') return 'unresolved_alignment';
  const maxPadasPerPart = Math.max(0, ...partInfos.map((pi) => pi.padaIdxs.length));
  const avgLen =
    tokenIndices.reduce((a, j) => a + ctx.surfaces[j].length, 0) / Math.max(1, tokenIndices.length);
  if (maxPadasPerPart >= 3 || avgLen < 2.5) return 'vidyut_segmentation';
  for (const j of tokenIndices) {
    if (dhatu.get(j)) return 'legitimate_ambiguity';
  }
  const div = levenshtein(entry.norm, ctx.slice) / Math.max(entry.norm.length, ctx.slice.length, 1);
  if (div > 0.5) return 'unresolved_alignment';
  // vidyut split a unit the gloss keeps whole, and nothing matched any piece
  for (const pi of partInfos) {
    if (pi.padaIdxs.length >= 2) return 'vidyut_segmentation';
  }
  if (div > 0) return 'legitimate_ambiguity'; // alternative sandhi resolutions
  // single clean pada per part, exact surface: a known pronominal form with
  // a divergent vidyut lemma is a vidyut lexeme quirk (we know the canonical
  // lemma); a related lexeme -> ambiguity; unrelated -> likely gloss-side.
  for (const pi of partInfos) {
    if (PRONOUN_FORMS[pi.part] || AVYAYA_FORMS.has(pi.part)) return 'vidyut_segmentation';
    for (const j of pi.padaIdxs) {
      const l = lemmaNorms.get(j) ?? '';
      if (commonPrefixLen(pi.part, l) >= 2) return 'legitimate_ambiguity';
    }
  }
  return 'llm_gloss_error';
}

function commonPrefixLen(a: string, b: string): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
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
  match_kind: LemmaMatchKind | null;
  parts_total: number;
  parts_matched: number;
  dhatu_flag: boolean;
  category: DisagreementCategory | null;
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
  words_aligned: number;
  aligned_rate: number;
  lemma_agree: number;
  lemma_disagree: number;
  agreement_rate: number;
  classifications: Record<WordClassification, number>;
  match_kinds: Record<LemmaMatchKind, number>;
  dhatu_flagged: number;
  categories: Record<DisagreementCategory, number>;
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

const EMPTY_CATEGORIES = (): Record<DisagreementCategory, number> => ({
  llm_gloss_error: 0,
  vidyut_segmentation: 0,
  legitimate_ambiguity: 0,
  unresolved_alignment: 0,
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
  const categories = EMPTY_CATEGORIES();
  const matchKinds: Record<LemmaMatchKind, number> = { exact: 0, variant: 0, stem: 0 };
  let wordsTotal = 0;
  let wordsAligned = 0;
  let dhatuFlagged = 0;
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
    const keptIdx: number[] = [];
    glossSlp1.forEach((w, i) => {
      if (toEntry(w).norm.length > 0) keptIdx.push(i);
    });

    const words: AuditWordRow[] = alignment.words.map((aw, k) => {
      const gi = keptIdx[k];
      const g = glosses[gi];
      classifications[aw.classification] += 1;
      wordsTotal += 1;
      if (aw.lemmaAgreement) agree += 1;
      if (aw.matchKind) matchKinds[aw.matchKind] += 1;
      if (aw.dhatuFlag) dhatuFlagged += 1;
      if (aw.category) categories[aw.category] += 1;
      const aligned =
        aw.classification !== 'unmatched' &&
        aw.classification !== 'split_crossing' &&
        aw.category !== 'unresolved_alignment';
      if (aligned) wordsAligned += 1;
      return {
        word_idx: typeof g.word_idx === 'number' ? g.word_idx : gi,
        word: glossSurfaces[gi],
        word_slp1: aw.word,
        llm_gloss_en: g.gloss_en ?? null,
        llm_morph: g.morph ?? null,
        vidyut_tokens: aw.tokenIndices.map((j) => mv.tokens[j]),
        classification: aw.classification,
        lemma_agreement: aw.lemmaAgreement,
        match_kind: aw.matchKind,
        parts_total: aw.parts.length,
        parts_matched: aw.partsMatched,
        dhatu_flag: aw.dhatuFlag,
        category: aw.category,
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
      words_aligned: wordsAligned,
      aligned_rate: wordsTotal === 0 ? 0 : Math.round((wordsAligned / wordsTotal) * 10000) / 10000,
      lemma_agree: agree,
      lemma_disagree: wordsTotal - agree,
      agreement_rate: wordsTotal === 0 ? 0 : Math.round((agree / wordsTotal) * 10000) / 10000,
      classifications,
      match_kinds: matchKinds,
      dhatu_flagged: dhatuFlagged,
      categories,
    },
    verses,
  };
}
