import Sanscript from '@indic-transliteration/sanscript';
import {
  type CorpusVerse,
  type MorphToken,
  type MorphVerse,
  alignVerse,
  buildAudit,
  iastToSlp1,
  lemmaMatchKind,
  normalizeSlp1,
  slp1ToIast,
} from '@pipeline/morph/compare';
/**
 * Unit tests for the morph trust-audit comparison logic
 * (pipeline/morph/compare.ts). Pure-function tests with fixture data —
 * no Vidyut install or linguistic data required.
 */
import { describe, expect, it } from 'vitest';

const tok = (surface: string, lemma: string | null = null): MorphToken => ({ surface, lemma });

describe('iastToSlp1', () => {
  it('maps long vowels and diphthongs', () => {
    expect(iastToSlp1('ātmā')).toBe('AtmA');
    expect(iastToSlp1('caitanyam')).toBe('cEtanyam');
    expect(iastToSlp1('bhairavaḥ')).toBe('BEravaH');
    expect(iastToSlp1('gauḥ')).toBe('gOH');
  });

  it('maps aspirates before single consonants (th vs ṭh, dh vs ḍh)', () => {
    expect(iastToSlp1('artha')).toBe('arTa');
    expect(iastToSlp1('dharma')).toBe('Darma');
    expect(iastToSlp1('kaṇṭha')).toBe('kaRWa');
    expect(iastToSlp1('ḍhakkā')).toBe('QakkA');
  });

  it('maps retroflexes, sibilants, anusvara, visarga', () => {
    expect(iastToSlp1('jñānaṃ')).toBe('jYAnaM');
    expect(iastToSlp1('śaktiḥ')).toBe('SaktiH');
    expect(iastToSlp1('ṛṣiḥ')).toBe('fziH');
    expect(iastToSlp1('kṛṣṇa')).toBe('kfzRa');
  });

  it('is case-insensitive and NFC-normalizing', () => {
    expect(iastToSlp1('Ātmā')).toBe('AtmA');
    // combining macron (a + U+0304) normalizes to precomposed ā
    expect(iastToSlp1('ātmā')).toBe('AtmA');
  });
});

describe('normalizeSlp1', () => {
  it('strips non-SLP1 characters (danda, avagraha, digits, hyphens)', () => {
    expect(normalizeSlp1('cEtanyamAtmA ॥1॥')).toBe('cEtanyamAtmA');
    expect(normalizeSlp1("so'ham")).toBe('soham');
    expect(normalizeSlp1('udyamo-BErava')).toBe('udyamoBErava');
  });

  it('normalizes final visarga to s and final anusvara to m', () => {
    expect(normalizeSlp1('rAmaH')).toBe('rAmas');
    expect(normalizeSlp1('jYAnaM')).toBe('jYAnam');
  });

  it('does not touch word-internal H or M', () => {
    expect(normalizeSlp1('duHKa')).toBe('duHKa');
    expect(normalizeSlp1('saMsAra')).toBe('saMsAra');
  });

  it('folds anusvara/class-nasal spelling variants before stops', () => {
    expect(normalizeSlp1('SaNkara')).toBe(normalizeSlp1('SaMkara'));
    expect(normalizeSlp1('sanDAna')).toBe(normalizeSlp1('saMDAna'));
    // nasal before a non-stop is untouched
    expect(normalizeSlp1('anya')).toBe('anya');
  });
});

describe('slp1ToIast', () => {
  it('inverts the deterministic SLP1 table', () => {
    expect(slp1ToIast('Atman')).toBe('ātman');
    expect(slp1ToIast('BErava')).toBe('bhairava');
    expect(slp1ToIast('kfzRa')).toBe('kṛṣṇa');
    expect(slp1ToIast('saMhf')).toBe('saṃhṛ');
    expect(slp1ToIast('Sakti')).toBe('śakti');
  });

  it('agrees with @indic-transliteration/sanscript (the ingest convention)', () => {
    for (const lemma of ['Atman', 'BErava', 'kfzRa', 'saMhf', 'Sakti', 'jYAna', 'udyama']) {
      expect(slp1ToIast(lemma)).toBe(Sanscript.t(lemma, 'slp1', 'iast'));
    }
  });

  it('round-trips through iastToSlp1', () => {
    for (const lemma of ['Atman', 'BErava', 'kfzRa', 'Sakti', 'aDizWAna']) {
      expect(iastToSlp1(slp1ToIast(lemma))).toBe(lemma);
    }
  });
});

describe('lemmaMatchKind (lemma normalizer ladder)', () => {
  it('exact match, including for dhatu lemmas', () => {
    expect(lemmaMatchKind('iti', 'iti', false)).toBe('exact');
    expect(lemmaMatchKind('tris', 'tris', true)).toBe('exact');
  });

  it('visarga / final-vowel nominal stem variants', () => {
    expect(lemmaMatchKind('udyamas', 'udyama', false)).toBe('variant'); // -aḥ ~ -a
    expect(lemmaMatchKind('jYAnam', 'jYAna', false)).toBe('variant'); // -am ~ -a
    expect(lemmaMatchKind('AtmA', 'Atman', false)).toBe('variant'); // -ā ~ -an
    expect(lemmaMatchKind('sanDAne', 'sanDAna', false)).toBe('variant'); // loc. -e ~ -a
    expect(lemmaMatchKind('Saktis', 'Sakti', false)).toBe('variant'); // -iḥ ~ -i
    expect(lemmaMatchKind('vaDu', 'vaDU', false)).toBe('variant'); // vowel length
  });

  it('suppletive pronominal paradigms count as variants', () => {
    expect(lemmaMatchKind('tezAm', 'tad', false)).toBe('variant');
    expect(lemmaMatchKind('yas', 'yad', false)).toBe('variant');
    expect(lemmaMatchKind('asO', 'adas', false)).toBe('variant');
  });

  it('guarded stem-prefix match for nominal lemmas only', () => {
    expect(lemmaMatchKind('banDas', 'banD', false)).toBe('stem');
    expect(lemmaMatchKind('cEtanyam', 'i', false)).toBeNull(); // micro-stem guard
  });

  it('dhatu lemmas are never variant/stem force-matched', () => {
    expect(lemmaMatchKind('jYAnam', 'jYA', true)).toBeNull();
    expect(lemmaMatchKind('udyamas', 'udyam', true)).toBeNull();
  });
});

describe('alignVerse', () => {
  it('exact-span mode: one token per word is a match', () => {
    const a = alignVerse(['jYAnaM', 'banDaH'], [tok('jYAnam', 'jYA'), tok('banDas', 'banD')]);
    expect(a.mode).toBe('exact-span');
    expect(a.words.map((w) => w.classification)).toEqual(['match', 'match']);
    expect(a.words[0].tokenIndices).toEqual([0]);
    expect(a.words[1].tokenIndices).toEqual([1]);
    expect(a.words.every((w) => w.lemmaAgreement)).toBe(true);
  });

  it('exact-span mode: detects splits (vidyut over-segments one word)', () => {
    // gloss word caitanyam vs vidyut cE+tanyam style over-splitting
    const a = alignVerse(
      ['cEtanyam', 'AtmA'],
      [tok('cE', 'ca'), tok('tanyam', null), tok('AtmA', 'Atman')],
    );
    expect(a.mode).toBe('exact-span');
    expect(a.words[0].classification).toBe('split');
    expect(a.words[0].tokenIndices).toEqual([0, 1]);
    expect(a.words[0].lemmaAgreement).toBe(false);
    expect(a.words[1].classification).toBe('match');
  });

  it('exact-span mode: detects merges (vidyut keeps a compound whole)', () => {
    const a = alignVerse(['yoni', 'vargaH'], [tok('yonivargas', null)]);
    expect(a.mode).toBe('exact-span');
    expect(a.words[0].classification).toBe('merged');
    expect(a.words[1].classification).toBe('merged');
    expect(a.words[0].tokenIndices).toEqual([0]);
  });

  it('exact-span mode: flags tokens straddling a word boundary', () => {
    // words: abcd | efg ; tokens: abc | defg
    const a = alignVerse(['abcd', 'efg'], [tok('abc'), tok('defg')]);
    expect(a.mode).toBe('exact-span');
    expect(a.words[0].classification).toBe('split_crossing');
    expect(a.words[1].classification).toBe('merged');
  });

  it('greedy mode: used when sandhi resolution diverges, still finds exact runs', () => {
    // visarga normalization makes udyamo (corpus sandhi form would differ)…
    // here token surface differs in length so concatenations differ.
    const a = alignVerse(
      ['udyamaH', 'BEravaH'],
      [tok('udyamas', 'udyam'), tok('BEravas', 'BErava'), tok('iti', 'iti')],
    );
    // words normalize to udyamas / BEravas; extra token makes G !== T
    expect(a.mode).toBe('greedy');
    expect(a.words[0].classification).toBe('match');
    expect(a.words[1].classification).toBe('match');
  });

  it('greedy mode: classifies diverged regions as mismatch and stays aligned', () => {
    const a = alignVerse(['Bavati', 'rAmaH'], [tok('Bavat'), tok('i'), tok('rAmo')]);
    expect(a.mode).toBe('greedy');
    // Bavat+i === Bavati -> split; rAmas vs rAmo diverged -> mismatch
    expect(a.words[0].classification).toBe('split');
    expect(a.words[1].classification).toBe('mismatch');
    expect(a.words[1].tokenIndices).toEqual([2]);
  });

  it('greedy mode: unmatched when tokens run out', () => {
    const a = alignVerse(['jYAnam', 'banDas'], [tok('jYAnam', 'jYA')]);
    expect(a.words[0].classification).toBe('match');
    expect(a.words[1].classification).toBe('unmatched');
    expect(a.words[1].tokenIndices).toEqual([]);
    expect(a.words[1].lemmaAgreement).toBe(false);
  });

  it('lemma agreement: stem match counts, micro-stems do not', () => {
    // merged token whose lemma is a real stem of the word
    const stem = alignVerse(['udyamas'], [tok('udyamo', 'udyama')]);
    expect(stem.words[0].classification).not.toBe('match');
    expect(stem.words[0].lemmaAgreement).toBe(true);

    // 1-char lemma covering <50% of the word must not count
    const micro = alignVerse(['cEtanyam'], [tok('cEtanyaH', 'i')]);
    expect(micro.words[0].lemmaAgreement).toBe(false);
  });

  it('drops words that normalize to nothing (punctuation-only entries)', () => {
    const a = alignVerse(['॥1॥', 'jYAnam'], [tok('jYAnam', 'jYA')]);
    expect(a.words).toHaveLength(1);
    expect(a.words[0].word).toBe('jYAnam');
  });
});

describe('alignVerse — calibrated agreement (sandhi-aware sets + normalizer)', () => {
  const vtok = (
    surface: string,
    lemma: string | null,
    pos?: string,
    entry?: string,
  ): MorphToken => ({ surface, lemma, pos: pos ?? null, entry: entry ?? null });

  it('sandhi-split case: a hyphenated gloss compound agrees when ANY aligned pada lemma matches its part', () => {
    // gloss keeps viśva-saṃhāraḥ whole; vidyut splits viSva + saMhAras
    const a = alignVerse(
      ['viSva-saMhAraH'],
      [
        vtok('viSva', 'viSva', 'subanta'),
        vtok(
          'saMhAras',
          'saMhf',
          'subanta',
          'PadaEntry.Subanta(pratipadika_entry=PratipadikaEntry.Krdanta(dhatu_entry=DhatuEntry(...)))',
        ),
      ],
    );
    expect(a.mode).toBe('exact-span');
    expect(a.words[0].classification).toBe('split');
    expect(a.words[0].tokenIndices).toEqual([0, 1]);
    expect(a.words[0].parts).toEqual(['viSva', 'saMhAras']);
    // viSva matched exactly -> the gloss word agrees (ANY-pada rule)
    expect(a.words[0].lemmaAgreement).toBe(true);
    expect(a.words[0].matchKind).toBe('exact');
    expect(a.words[0].partsMatched).toBe(1);
    // saMhf is a dhatu lemma vs the derived stem saMhAra: flagged, not forced
    expect(a.words[0].dhatuFlag).toBe(true);
    expect(a.words[0].category).toBeNull();
  });

  it('visarga case: gloss -aḥ form vs vidyut nominal stem is a variant agreement', () => {
    const a = alignVerse([iastToSlp1('śaktiḥ')], [vtok('Saktis', 'Sakti', 'subanta')]);
    expect(a.words[0].classification).toBe('match');
    expect(a.words[0].lemmaAgreement).toBe(true);
    expect(a.words[0].matchKind).toBe('variant');
  });

  it('SLP1/anusvara case: nasal spelling variants align and agree', () => {
    const a = alignVerse([iastToSlp1('śaṅkaram')], [vtok('SaMkaram', 'SaMkara', 'subanta')]);
    expect(a.mode).toBe('exact-span');
    expect(a.words[0].classification).toBe('match');
    expect(a.words[0].lemmaAgreement).toBe(true);
    expect(a.words[0].matchKind).toBe('variant');
  });

  it('DP fallback: diverged sandhi resolution still aligns word-to-pada spans', () => {
    // gloss: turya-ābhogaḥ | sambhavaḥ ; vidyut: turyAs + Boga + samBavas
    const a = alignVerse(
      ['turya-ABogaH', 'samBavaH'],
      [
        vtok('turyAs', 'turya', 'subanta'),
        vtok('Boga', 'Boga', 'subanta'),
        vtok('samBavas', 'samBava', 'subanta'),
      ],
    );
    expect(a.mode).toBe('greedy');
    expect(a.words[0].classification).toBe('mismatch'); // a+A coalesced differently
    expect(a.words[0].tokenIndices).toEqual([0, 1]);
    expect(a.words[0].lemmaAgreement).toBe(true); // turya matched exactly
    expect(a.words[1].classification).toBe('match');
    expect(a.words[1].lemmaAgreement).toBe(true);
    expect(a.words[1].matchKind).toBe('variant');
  });

  it('dhatu vs derived stem: flagged, not matched, categorized as legitimate ambiguity', () => {
    const a = alignVerse(
      ['ullasanti'],
      [vtok('ut', 'u', 'subanta'), vtok('lasanti', 'las', 'tinanta')],
    );
    expect(a.words[0].lemmaAgreement).toBe(false);
    expect(a.words[0].dhatuFlag).toBe(true);
    expect(a.words[0].category).toBe('legitimate_ambiguity');
  });

  it('pronominal suppletion agrees; vidyut pronoun lemma quirks go to the vidyut bucket', () => {
    const agree = alignVerse(['tezAm'], [vtok('tezAm', 'tad', 'subanta')]);
    expect(agree.words[0].lemmaAgreement).toBe(true);
    expect(agree.words[0].matchKind).toBe('variant');

    // vidyut lemmatizes yas to I (a quirk); we know yas belongs to yad
    const quirk = alignVerse(['yaH'], [vtok('yas', 'I', 'subanta')]);
    expect(quirk.words[0].lemmaAgreement).toBe(false);
    expect(quirk.words[0].category).toBe('vidyut_segmentation');
  });

  it('null-lemma kosha misses are categorized as vidyut-side', () => {
    const a = alignVerse(['yoni-vargaH'], [vtok('yonivargas', null)]);
    expect(a.words[0].lemmaAgreement).toBe(false);
    expect(a.words[0].category).toBe('vidyut_segmentation');
  });

  it('micro-token shredding is categorized as vidyut segmentation error', () => {
    const a = alignVerse(
      ['cEtanyam', 'AtmA'],
      [
        vtok('ca', 'ca', 'subanta'),
        vtok('Et', 'i', 'tinanta'),
        vtok('an', 'aYji', 'subanta'),
        vtok('yam', 'I', 'subanta'),
        vtok('AtmA', 'Atman', 'subanta'),
      ],
    );
    expect(a.words[0].lemmaAgreement).toBe(false);
    expect(a.words[0].category).toBe('vidyut_segmentation');
    expect(a.words[1].lemmaAgreement).toBe(true);
    expect(a.words[1].matchKind).toBe('variant');
  });

  it('words with no aligned padas are unresolved', () => {
    const a = alignVerse(['jYAnam', 'banDas'], [tok('jYAnam', 'jYAna')]);
    expect(a.words[1].classification).toBe('unmatched');
    expect(a.words[1].category).toBe('unresolved_alignment');
  });

  it('multi-word gloss entries (spaces) align part-by-part', () => {
    const a = alignVerse(
      ['idaM sarvam'],
      [vtok('idam', 'idam', 'subanta'), vtok('sarvam', 'sarva', 'subanta')],
    );
    expect(a.words[0].classification).toBe('split');
    expect(a.words[0].parts).toEqual(['idam', 'sarvam']);
    expect(a.words[0].partsMatched).toBe(2);
    expect(a.words[0].lemmaAgreement).toBe(true);
  });
});

describe('buildAudit', () => {
  const corpus: CorpusVerse[] = [
    {
      ref: '1.1',
      word_glosses: [
        {
          word: 'caitanyam',
          iast: 'caitanyam',
          gloss_en: 'pure consciousness',
          morph: 'nom. sg. n.',
        },
        { word: 'ātmā', iast: 'ātmā', gloss_en: 'the Self', morph: 'nom. sg. m.' },
      ],
    },
    {
      ref: '1.2',
      word_glosses: [
        { word: 'jñānaṃ', iast: 'jñānaṃ', gloss_en: 'knowledge' },
        { word: 'bandhaḥ', iast: 'bandhaḥ', gloss_en: 'bondage' },
      ],
    },
    { ref: '1.3', word_glosses: [] }, // no glosses -> skipped
    {
      ref: '1.4',
      word_glosses: [{ word: 'udyamaḥ', iast: 'udyamaḥ', gloss_en: 'upsurge' }],
    }, // no morph output -> skipped
  ];

  const morph = new Map<string, MorphVerse>([
    [
      '1.1',
      {
        ref: '1.1',
        input: 'cEtanyamAtmA',
        tokens: [tok('cE', 'ca'), tok('tanyam', null), tok('AtmA', 'Atman')],
      },
    ],
    [
      '1.2',
      {
        ref: '1.2',
        input: 'jYAnaM banDaH',
        tokens: [tok('jYAnam', 'jYA'), tok('banDas', 'banD')],
      },
    ],
  ]);

  it('builds per-verse rows with corpus context and vidyut tokens', () => {
    const audit = buildAudit('test-text', corpus, morph);
    expect(audit.text_slug).toBe('test-text');
    expect(audit.verses).toHaveLength(2);

    const v11 = audit.verses[0];
    expect(v11.ref).toBe('1.1');
    expect(v11.words[0].word).toBe('caitanyam');
    expect(v11.words[0].word_slp1).toBe('cEtanyam');
    expect(v11.words[0].llm_gloss_en).toBe('pure consciousness');
    expect(v11.words[0].llm_morph).toBe('nom. sg. n.');
    expect(v11.words[0].classification).toBe('split');
    expect(v11.words[0].lemma_agreement).toBe(false);
    expect(v11.words[0].vidyut_tokens.map((t) => t.surface)).toEqual(['cE', 'tanyam']);

    // ātmā matches surface AtmA exactly
    expect(v11.words[1].classification).toBe('match');
    expect(v11.words[1].lemma_agreement).toBe(true);
  });

  it('summarizes agreement and skip counts', () => {
    const audit = buildAudit('test-text', corpus, morph);
    const s = audit.summary;
    expect(s.verses_compared).toBe(2);
    expect(s.verses_without_glosses).toBe(1);
    expect(s.verses_without_morph).toBe(1);
    expect(s.words_total).toBe(4);
    // agree: ātmā (match), jñānaṃ (match), bandhaḥ (match) = 3
    expect(s.lemma_agree).toBe(3);
    expect(s.lemma_disagree).toBe(1);
    expect(s.agreement_rate).toBe(0.75);
    expect(s.classifications.match).toBe(3);
    expect(s.classifications.split).toBe(1);
  });

  it('uses explicit word_idx when present, array index otherwise', () => {
    const audit = buildAudit(
      't',
      [
        {
          ref: '1.1',
          word_glosses: [{ iast: 'jñānaṃ', word_idx: 7 }, { iast: 'bandhaḥ' }],
        },
      ],
      new Map([['1.1', { ref: '1.1', input: '', tokens: [tok('jYAnam'), tok('banDas')] }]]),
    );
    expect(audit.verses[0].words[0].word_idx).toBe(7);
    expect(audit.verses[0].words[1].word_idx).toBe(1);
  });

  it('returns zero-rate summary when nothing is comparable', () => {
    const audit = buildAudit('t', [{ ref: '1.1', word_glosses: [] }], new Map());
    expect(audit.summary.words_total).toBe(0);
    expect(audit.summary.agreement_rate).toBe(0);
    expect(audit.verses).toHaveLength(0);
  });

  it('emits calibration fields: aligned rate, match kinds, categories, per-row triage', () => {
    const audit = buildAudit('test-text', corpus, morph);
    const s = audit.summary;
    expect(s.words_aligned).toBe(4);
    expect(s.aligned_rate).toBe(1);
    expect(s.match_kinds.variant + s.match_kinds.exact + s.match_kinds.stem).toBe(s.lemma_agree);
    expect(s.categories.vidyut_segmentation).toBe(1); // caitanyam shredded into cE+tanyam
    expect(s.categories.llm_gloss_error).toBe(0);

    const caitanyam = audit.verses[0].words[0];
    expect(caitanyam.category).toBe('vidyut_segmentation');
    expect(caitanyam.parts_total).toBe(1);
    expect(caitanyam.parts_matched).toBe(0);

    const atma = audit.verses[0].words[1];
    expect(atma.category).toBeNull();
    expect(atma.match_kind).toBe('variant'); // AtmA ~ Atman
  });
});
