"""
Hand-authored word-by-word gloss data for the sohamhamso corpus.

Keyed by (text_id, chapter, verse_num) → list of gloss dicts.

Per-file conventions (must match what's already in the file):
  - vijnana-bhairava-tantra: `word` holds IAST (no Devanagari yet); `iast` mirrors.
  - pratyabhijna-hrdayam:    `word` holds Devanāgarī; `iast` holds IAST surface.
  - siva-sutras:             `word` holds IAST (some compounds hyphenated).
  - spanda-karikas:          `word` holds Devanāgarī; `iast` holds IAST surface.

Each gloss dict uses keys: word, iast, gloss_en, morph (optionally word_idx).
We omit word_idx — the ingester defaults to the array position, which matches
verse word order, which is what we want.

Quality bar: each gloss is short, lowercase (English), and reflects what the
word actually does in that line. Where a compound is naturally treated as a
unit by Trika translators, it stays as a unit; otherwise it is split.
"""

from __future__ import annotations

# Shorthand to keep the data block readable.
def g(word: str, gloss: str, morph: str | None = None, iast: str | None = None) -> dict:
    out: dict = {"word": word, "iast": iast or word, "gloss_en": gloss}
    if morph:
        out["morph"] = morph
    return out


def dg(deva: str, iast: str, gloss: str, morph: str | None = None) -> dict:
    """Devanāgarī surface, IAST lemma — for pratyabhijna and spanda."""
    out: dict = {"word": deva, "iast": iast, "gloss_en": gloss}
    if morph:
        out["morph"] = morph
    return out


GLOSSES: dict[tuple[str, int, int], list[dict]] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Pratyabhijñāhṛdayam — all 20 sūtras
# ─────────────────────────────────────────────────────────────────────────────

# 1.1 — citiḥ svatantrā viśvasiddhihetuḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 1)] = [
    dg("चितिः", "citiḥ", "Consciousness, the absolute Awareness", "nom. sg. f."),
    dg("स्वतन्त्रा", "svatantrā", "self-dependent, free, autonomous", "nom. sg. f. adj."),
    dg("विश्व", "viśva", "the universe, the all", "stem in cpd."),
    dg("सिद्धि", "siddhi", "accomplishment, manifestation, establishment", "stem in cpd."),
    dg("हेतुः", "hetuḥ", "the cause", "nom. sg. m."),
]

# 1.2 — svecchayā svabhittau viśvam unmīlayati
GLOSSES[("pratyabhijna-hrdayam", 1, 2)] = [
    dg("स्व-इच्छया", "sva-icchayā", "by her own will", "inst. sg. f."),
    dg("स्व-भित्तौ", "sva-bhittau", "on her own canvas (screen of the Self)", "loc. sg. f."),
    dg("विश्वम्", "viśvam", "the universe", "acc. sg. n."),
    dg("उन्मीलयति", "unmīlayati", "unfolds, makes manifest (lit. 'opens out')", "3sg. pres. caus. √mīl"),
]

# 1.3 — tan nānā anurūpa-grāhya-grāhaka-bhedāt
GLOSSES[("pratyabhijna-hrdayam", 1, 3)] = [
    dg("तत्", "tat", "that (universe)", "nom. sg. n."),
    dg("नाना", "nānā", "manifold, various", "indecl."),
    dg("अनुरूप", "anurūpa", "corresponding, conformable", "stem in cpd."),
    dg("ग्राह्य", "grāhya", "the perceivable (object)", "stem in cpd."),
    dg("ग्राहक", "grāhaka", "the perceiver (subject)", "stem in cpd."),
    dg("भेदात्", "bhedāt", "by reason of the differentiation", "abl. sg. m."),
]

# 1.4 — citi-saṃkocātmā cetano 'pi saṅkucita-viśvamayaḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 4)] = [
    dg("चिति-सङ्कोच-आत्मा", "citi-saṃkoca-ātmā", "having a contraction of Consciousness as its essence", "nom. sg. m. cpd."),
    dg("चेतनः", "cetanaḥ", "the sentient being, the experient", "nom. sg. m."),
    dg("अपि", "api", "even, also", "ptcl."),
    dg("सङ्कुचित", "saṅkucita", "contracted, narrowed", "ppp. stem in cpd."),
    dg("विश्व-मयः", "viśva-mayaḥ", "made of the universe, identical with the universe", "nom. sg. m. cpd."),
]

# 1.5 — citir eva cetana-padād avarūḍhā cetya-saṅkocinī cittam
GLOSSES[("pratyabhijna-hrdayam", 1, 5)] = [
    dg("चितिः", "citiḥ", "Consciousness itself", "nom. sg. f."),
    dg("एव", "eva", "indeed, alone", "ptcl. emph."),
    dg("चेतन-पदात्", "cetana-padāt", "from the level of the (free) experient", "abl. sg. n. cpd."),
    dg("अवरूढा", "avarūḍhā", "descended, fallen", "ppp. nom. sg. f."),
    dg("चेत्य-सङ्कोचिनी", "cetya-saṅkocinī", "contracting itself to the knowable (object)", "nom. sg. f. cpd."),
    dg("चित्तम्", "cittam", "is (called) citta — the individualized mind", "nom. sg. n."),
]

# 1.6 — tan-mayo māyā-pramātā
GLOSSES[("pratyabhijna-hrdayam", 1, 6)] = [
    dg("तत्-मयः", "tat-mayaḥ", "made of that (citta)", "nom. sg. m. cpd."),
    dg("माया-प्रमाता", "māyā-pramātā", "is the māyic experient (the soul bound by māyā)", "nom. sg. m. cpd."),
]

# 1.7 — sa caiko dvi-rūpas tri-mayaś catur-ātmā sapta-pañcaka-svabhāvaḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 7)] = [
    dg("सः", "saḥ", "he (the experient)", "nom. sg. m."),
    dg("च", "ca", "and", "conj."),
    dg("एकः", "ekaḥ", "one (in essence)", "nom. sg. m."),
    dg("द्वि-रूपः", "dvi-rūpaḥ", "of two forms (Śiva–Śakti)", "nom. sg. m. cpd."),
    dg("त्रि-मयः", "tri-mayaḥ", "consisting of three (āṇava/śākta/śāmbhava or three malas)", "nom. sg. m. cpd."),
    dg("चतुर्-आत्मा", "catur-ātmā", "having four selves (the four states of consciousness)", "nom. sg. m. cpd."),
    dg("सप्त-पञ्चक", "sapta-pañcaka", "the seven pentads", "stem in cpd."),
    dg("स्वभावः", "svabhāvaḥ", "is of that own nature", "nom. sg. m."),
]

# 1.8 — tad-bhūmikāḥ sarva-darśana-sthitayaḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 8)] = [
    dg("तत्-भूमिकाः", "tat-bhūmikāḥ", "roles/stages of that (one Consciousness)", "nom. pl. f. cpd."),
    dg("सर्व", "sarva", "all", "adj. stem"),
    dg("दर्शन", "darśana", "philosophical view, system", "stem in cpd."),
    dg("स्थितयः", "sthitayaḥ", "are the standpoints", "nom. pl. f."),
]

# 1.9 — cid-vat tac-chakti-saṅkocān malāvṛtaḥ saṃsārī
GLOSSES[("pratyabhijna-hrdayam", 1, 9)] = [
    dg("चित्-वत्", "cit-vat", "though of the nature of Consciousness", "adv./adj. cpd."),
    dg("तत्-शक्ति-सङ्कोचात्", "tat-śakti-saṅkocāt", "owing to the contraction of his own powers", "abl. sg. m. cpd."),
    dg("मल-आवृतः", "mala-āvṛtaḥ", "covered by the impurities (malas)", "nom. sg. m. cpd."),
    dg("संसारी", "saṃsārī", "becomes the transmigrant", "nom. sg. m."),
]

# 1.10 — tathāpi tad-vat pañca-kṛtyāni karoti
GLOSSES[("pratyabhijna-hrdayam", 1, 10)] = [
    dg("तथापि", "tathāpi", "yet even so", "conj."),
    dg("तत्-वत्", "tad-vat", "like Him (Śiva)", "adv."),
    dg("पञ्च-कृत्यानि", "pañca-kṛtyāni", "the five acts (sṛṣṭi, sthiti, saṃhāra, tirodhāna, anugraha)", "acc. pl. n. cpd."),
    dg("करोति", "karoti", "performs", "3sg. pres. √kṛ"),
]

# 1.11 — ābhāsana-rakti-vimarśana-bījāvasthāpana-vilāpanatas tāni
GLOSSES[("pratyabhijna-hrdayam", 1, 11)] = [
    dg("आभासन", "ābhāsana", "manifesting (= sṛṣṭi, emission)", "stem in cpd."),
    dg("रक्ति", "rakti", "relishing (= sthiti, maintenance)", "stem in cpd."),
    dg("विमर्शन", "vimarśana", "reflective grasp (= saṃhāra, withdrawal)", "stem in cpd."),
    dg("बीज-अवस्थापन", "bīja-avasthāpana", "placing in seed-form (= tirodhāna, concealment)", "stem in cpd."),
    dg("विलापनतः", "vilāpanataḥ", "and dissolving (= anugraha, grace) — by these", "abl. sg. n. cpd."),
    dg("तानि", "tāni", "those five acts (are accomplished)", "acc. pl. n."),
]

# 1.12 — tad-aparijñāne sva-śaktibhir vyāmohitatā saṃsāritvam
GLOSSES[("pratyabhijna-hrdayam", 1, 12)] = [
    dg("तत्-अपरिज्ञाने", "tat-aparijñāne", "when there is non-recognition of that (true nature)", "loc. sg. n. cpd."),
    dg("स्व-शक्तिभिः", "sva-śaktibhiḥ", "by one's own powers", "inst. pl. f. cpd."),
    dg("व्यामोहितता", "vyāmohitatā", "the state of being utterly deluded", "nom. sg. f."),
    dg("संसारित्वम्", "saṃsāritvam", "is transmigratory existence", "nom. sg. n."),
]

# 1.13 — tat-parijñāne cittam eva antarmukhī-bhāvena cetana-padādhyārohāc citiḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 13)] = [
    dg("तत्-परिज्ञाने", "tat-parijñāne", "when there is full recognition of that", "loc. sg. n. cpd."),
    dg("चित्तम्", "cittam", "the (limited) mind", "nom. sg. n."),
    dg("एव", "eva", "itself", "ptcl. emph."),
    dg("अन्तर्मुखी-भावेन", "antarmukhī-bhāvena", "by becoming inward-facing", "inst. sg. m. cpd."),
    dg("चेतन-पद-अध्यारोहात्", "cetana-pada-adhyārohāt", "through ascent to the level of the (free) experient", "abl. sg. m. cpd."),
    dg("चितिः", "citiḥ", "becomes Citi (universal Consciousness)", "nom. sg. f."),
]

# 1.14 — citi-vahnir avaroha-pade channo 'pi mātrayā meyendhanaṃ pluṣyati
GLOSSES[("pratyabhijna-hrdayam", 1, 14)] = [
    dg("चिति-वह्निः", "citi-vahniḥ", "the fire of Consciousness", "nom. sg. m. cpd."),
    dg("अवरोह-पदे", "avaroha-pade", "at the level of descent (= the bound state)", "loc. sg. n. cpd."),
    dg("छन्नः", "channaḥ", "though concealed", "nom. sg. m. ppp."),
    dg("अपि", "api", "even", "ptcl."),
    dg("मात्रया", "mātrayā", "partially", "inst. sg. f."),
    dg("मेय-इन्धनम्", "meya-indhanam", "the fuel of objects of knowledge", "acc. sg. n. cpd."),
    dg("प्लुष्यति", "pluṣyati", "burns up", "3sg. pres. √pluṣ"),
]

# 1.15 — bala-lābhe viśvam ātmasāt karoti
GLOSSES[("pratyabhijna-hrdayam", 1, 15)] = [
    dg("बल-लाभे", "bala-lābhe", "on attaining the power (of Citi)", "loc. sg. m. cpd."),
    dg("विश्वम्", "viśvam", "the universe", "acc. sg. n."),
    dg("आत्मसात्", "ātmasāt", "as one's own self", "indecl. (sāc-affix)"),
    dg("करोति", "karoti", "one makes", "3sg. pres. √kṛ"),
]

# 1.16 — cid-ānanda-lābhe dehādiṣu cetyamāneṣv api cid-aikātmya-pratipatti-dārḍhyaṃ jīvan-muktiḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 16)] = [
    dg("चित्-आनन्द-लाभे", "cit-ānanda-lābhe", "on attaining the bliss of Consciousness", "loc. sg. m. cpd."),
    dg("देह-आदिषु", "deha-ādiṣu", "in the body and other objects", "loc. pl. m. cpd."),
    dg("चेत्यमानेषु", "cetyamāneṣu", "while being objectified", "loc. pl. n. pass. part."),
    dg("अपि", "api", "even", "ptcl."),
    dg("चित्-ऐकात्म्य-प्रतिपत्ति-दार्ढ्यम्", "cit-aikātmya-pratipatti-dārḍhyam", "the firm conviction of one’s identity with Consciousness", "nom. sg. n. cpd."),
    dg("जीवन्-मुक्तिः", "jīvan-muktiḥ", "is liberation-while-living", "nom. sg. f. cpd."),
]

# 1.17 — madhya-vikāsāc cid-ānanda-lābhaḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 17)] = [
    dg("मध्य-विकासात्", "madhya-vikāsāt", "by unfoldment of the centre (the central channel)", "abl. sg. m. cpd."),
    dg("चित्-आनन्द-लाभः", "cit-ānanda-lābhaḥ", "is the attainment of the bliss of Consciousness", "nom. sg. m. cpd."),
]

# 1.18 — vikalpa-kṣaya-śakti-saṅkoca-vikāsa-vāha-cchedādy-antakoṭi-nibhālanādaya ihopāyāḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 18)] = [
    dg("विकल्प-क्षय", "vikalpa-kṣaya", "dissolution of thought-constructs", "stem in cpd."),
    dg("शक्ति-सङ्कोच-विकास", "śakti-saṅkoca-vikāsa", "contraction and expansion of powers", "stem in cpd."),
    dg("वाह-च्छेद", "vāha-ccheda", "cutting the flow (of prāṇa/apāna)", "stem in cpd."),
    dg("आदि", "ādi", "and so forth", "ptcl. in cpd."),
    dg("अन्त-कोटि-निभालन", "anta-koṭi-nibhālana", "attentive watching of the two end-points", "stem in cpd."),
    dg("आदयः", "ādayaḥ", "etc. (these and similar)", "nom. pl. m."),
    dg("इह", "iha", "here (in this teaching)", "adv."),
    dg("उपायाः", "upāyāḥ", "are the means", "nom. pl. m."),
]

# 1.19 — samādhi-saṃskāravati vyutthāne bhūyo bhūyaś cid-aikyāmarśān nityodita-samādhi-lābhaḥ
GLOSSES[("pratyabhijna-hrdayam", 1, 19)] = [
    dg("समाधि-संस्कारवति", "samādhi-saṃskāravati", "in the post-samādhi state still bearing its impression", "loc. sg. n. cpd."),
    dg("व्युत्थाने", "vyutthāne", "during emergence (return to outer activity)", "loc. sg. n."),
    dg("भूयो भूयः", "bhūyo bhūyaḥ", "again and again", "adv."),
    dg("चित्-ऐक्य-आमर्शात्", "cit-aikya-āmarśāt", "by reflective awareness of identity with Consciousness", "abl. sg. m. cpd."),
    dg("नित्य-उदित-समाधि-लाभः", "nitya-udita-samādhi-lābhaḥ", "comes the attainment of ever-arising samādhi", "nom. sg. m. cpd."),
]

# 1.20 — long sūtra, summarizing the result
GLOSSES[("pratyabhijna-hrdayam", 1, 20)] = [
    dg("तदा", "tadā", "then", "adv."),
    dg("प्रकाश-आनन्द-सार", "prakāśa-ānanda-sāra", "whose essence is light and bliss", "stem in cpd."),
    dg("महा-मन्त्र-वीर्य-आत्मक", "mahā-mantra-vīrya-ātmaka", "constituted of the potency of the great mantra (Aham)", "stem in cpd."),
    dg("पूर्ण-अहन्ता-वेशात्", "pūrṇa-ahantā-veśāt", "through entry into the perfect ‘I-ness’", "abl. sg. m. cpd."),
    dg("सदा सर्व-सर्ग-संहार-कारि", "sadā sarva-sarga-saṃhāra-kāri", "ever performing all creation and dissolution", "stem in cpd."),
    dg("निज-संविद्-देवता-चक्र-ईश्वरता-प्राप्तिः", "nija-saṃvid-devatā-cakra-īśvaratā-prāptiḥ", "comes the attainment of lordship over the wheel of one’s own deities of Consciousness", "nom. sg. f. cpd."),
    dg("भवति", "bhavati", "arises", "3sg. pres. √bhū"),
    dg("इति शिवम्", "iti śivam", "thus, all is auspicious", "phrase"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Vijñāna Bhairava Tantra — priority verses (frame + key dhāraṇās including 1.47)
# ─────────────────────────────────────────────────────────────────────────────

# 1.1 — śrīdevy uvāca …
GLOSSES[("vijnana-bhairava-tantra", 1, 1)] = [
    g("śrīdevī", "the blessed Goddess (Bhairavī)", "nom. sg. f."),
    g("uvāca", "said", "3sg. pf. √vac"),
    g("śrutam", "heard", "ppp. nom. sg. n."),
    g("deva", "O Lord", "voc. sg. m."),
    g("mayā", "by me", "inst. sg."),
    g("sarvam", "everything, the whole", "acc. sg. n."),
    g("rudrayāmala-sambhavam", "originating from the Rudra-yāmala Tantra", "acc. sg. n. cpd."),
    g("trika-bhedam", "the divisions of the Trika", "acc. sg. m. cpd."),
    g("aśeṣeṇa", "without remainder, completely", "inst. sg. n."),
    g("sārāt sāra-vibhāgaśaḥ", "distinguished from the essence of the essence", "adv. cpd."),
]

# 1.2 — adyāpi na nivṛtto me saṃśayaḥ parameśvara
GLOSSES[("vijnana-bhairava-tantra", 1, 2)] = [
    g("adya api", "even today", "adv. + ptcl."),
    g("na", "not", "neg."),
    g("nivṛttaḥ", "ceased, dispelled", "ppp. nom. sg. m."),
    g("me", "my, of me", "gen. sg."),
    g("saṃśayaḥ", "doubt", "nom. sg. m."),
    g("parameśvara", "O Supreme Lord", "voc. sg. m."),
    g("kim", "what?", "interrog."),
    g("rūpam", "form, nature", "nom. sg. n."),
    g("tattvataḥ", "in reality, truly", "adv."),
    g("deva", "O God", "voc. sg. m."),
    g("śabda-rāśi-kalā-mayam", "consisting of the totality of phonemes and the kalās", "nom. sg. n. cpd."),
]

# 1.3 — kiṃ vā navātma-bhedena bhairave bhairavākṛtau …
GLOSSES[("vijnana-bhairava-tantra", 1, 3)] = [
    g("kim vā", "or is it?", "interrog. + ptcl."),
    g("navātma-bhedena", "by the division of the nine selves", "inst. sg. m. cpd."),
    g("bhairave", "in Bhairava", "loc. sg. m."),
    g("bhairavākṛtau", "in the form of Bhairava", "loc. sg. f. cpd."),
    g("triśiraḥ-bheda-bhinnam", "divided by the three-headed division", "nom. sg. n. cpd."),
    g("vā", "or", "conj."),
    g("kim vā", "or is it", "interrog."),
    g("śakti-trayātmakam", "consisting of the triad of Powers", "nom. sg. n. cpd."),
]

# 1.4 — nāda-bindu-mayaṃ vāpi …
GLOSSES[("vijnana-bhairava-tantra", 1, 4)] = [
    g("nāda-bindu-mayam", "consisting of nāda and bindu", "nom. sg. n. cpd."),
    g("vā api", "or even", "ptcl."),
    g("kim", "is it?", "interrog."),
    g("candra-ardha-nirodhikāḥ", "the half-moon and the restraining (forms)", "nom. pl. f. cpd."),
    g("cakra-ārūḍham", "mounted on the wheel", "nom. sg. n. cpd."),
    g("anackam", "the vowel-less (i.e. pure consonant)", "nom. sg. n."),
    g("vā", "or", "conj."),
    g("kim vā", "or is it", "interrog."),
    g("śakti-svarūpakam", "of the very nature of Śakti", "nom. sg. n. cpd."),
]

# 1.5 — parāparāyāḥ sakalam aparāyāś ca vā punaḥ …
GLOSSES[("vijnana-bhairava-tantra", 1, 5)] = [
    g("parāparāyāḥ", "of parāparā (the intermediate Goddess)", "gen. sg. f."),
    g("sakalam", "the manifest, with-parts (state)", "nom./acc. sg. n."),
    g("aparāyāḥ", "of aparā (the lower Goddess)", "gen. sg. f."),
    g("ca vā", "or and", "conj."),
    g("punaḥ", "again", "adv."),
    g("parāyāḥ", "of parā (the highest Goddess)", "gen. sg. f."),
    g("yadi", "if", "conj."),
    g("tadvat", "in the same way", "adv."),
    g("syāt", "would be", "3sg. opt. √as"),
    g("paratvam", "the state of supremacy", "nom. sg. n."),
    g("tat", "that", "nom. sg. n."),
    g("virudhyate", "is contradicted", "3sg. pres. pass."),
]

# 1.6 — na hi varṇa-vibhedena dehabhedena vā bhavet
GLOSSES[("vijnana-bhairava-tantra", 1, 6)] = [
    g("na hi", "for not", "neg. + ptcl."),
    g("varṇa-vibhedena", "by distinction of letters/colors", "inst. sg. m. cpd."),
    g("deha-bhedena", "by distinction of bodies", "inst. sg. m. cpd."),
    g("vā", "or", "conj."),
    g("bhavet", "could be", "3sg. opt. √bhū"),
    g("paratvam", "supremacy", "nom. sg. n."),
    g("niṣkalatvena", "by partlessness", "inst. sg. n."),
    g("sakalatve", "in the with-parts state", "loc. sg. n."),
    g("na tad bhavet", "that cannot be", "phrase"),
]

# 1.7 — prasādaṃ kuru me nātha …
GLOSSES[("vijnana-bhairava-tantra", 1, 7)] = [
    g("prasādam", "favour, grace", "acc. sg. m."),
    g("kuru", "do, bestow", "2sg. impv. √kṛ"),
    g("me", "to me", "gen./dat. sg."),
    g("nātha", "O Lord", "voc. sg. m."),
    g("niḥśeṣam", "without remainder, completely", "adv."),
    g("chindhi", "cut, sever", "2sg. impv. √chid"),
    g("saṃśayam", "doubt", "acc. sg. m."),
    g("bhairavaḥ uvāca", "Bhairava said", "phrase"),
    g("sādhu sādhu", "well, well!", "interj."),
    g("tvayā pṛṣṭam", "asked by you", "phrase"),
    g("tantra-sāram", "the essence of tantra", "acc. sg. n. cpd."),
    g("idam priye", "this, O beloved", "phrase"),
]

# 1.8 — guhyāti-guhya-goptṛ tvaṃ …
GLOSSES[("vijnana-bhairava-tantra", 1, 8)] = [
    g("guhyātiguhya-goptṛ", "O guardian of the secret-of-secrets", "voc. sg. f."),
    g("tvam", "you", "nom. sg."),
    g("yadi api", "although", "conj."),
    g("idam", "this", "nom. sg. n."),
    g("varānane", "O fair-faced one", "voc. sg. f."),
    g("tathā api", "yet even so", "conj."),
    g("kathayiṣyāmi", "I shall tell", "1sg. fut. √kath"),
    g("yathā", "as", "adv."),
    g("vetsi", "you know", "2sg. pres. √vid"),
    g("tathā śṛṇu", "thus listen", "phrase"),
]

# 1.9 — yat paraṃ niṣkalaṃ devi …
GLOSSES[("vijnana-bhairava-tantra", 1, 9)] = [
    g("yat", "that which", "rel. nom. sg. n."),
    g("param", "is supreme", "nom. sg. n."),
    g("niṣkalam", "partless", "nom. sg. n."),
    g("devi", "O Goddess", "voc. sg. f."),
    g("sarva-tattvāti-gocaram", "beyond the range of all the tattvas", "nom. sg. n. cpd."),
    g("tat tu śakyam na", "that surely cannot be", "phrase"),
    g("tena", "by him", "inst. sg. m."),
    g("iha", "here (in words)", "adv."),
    g("vaktum", "to be told", "inf. √vac"),
    g("śakyam tat", "is that which can be", "phrase"),
    g("icchayā", "by mere wish", "inst. sg. f."),
]

# 1.10 — devi prakṛti-rūpā yā …
GLOSSES[("vijnana-bhairava-tantra", 1, 10)] = [
    g("devi", "O Goddess", "voc. sg. f."),
    g("prakṛti-rūpā", "having the form of prakṛti", "nom. sg. f. cpd."),
    g("yā", "she who", "rel. nom. sg. f."),
    g("tasyāḥ", "her", "gen. sg. f."),
    g("kim rūpam", "what form?", "interrog."),
    g("ucyate", "is said", "3sg. pres. pass. √vac"),
    g("sakalatve", "in the with-parts state", "loc. sg. n."),
    g("vikalpānām", "of thought-constructs", "gen. pl. m."),
    g("sakala-advaita-kalpanā", "an imagined non-duality of the manifest", "nom. sg. f. cpd."),
]

# 1.11 — frame narrative
GLOSSES[("vijnana-bhairava-tantra", 1, 11)] = [
    g("tadā", "then", "adv."),
    g("tasmin mahā-vyomni", "in that great void", "loc. sg. n. cpd."),
    g("pralīne", "when dissolved", "loc. sg. m. ppp."),
    g("śaśi-bhāskare", "(when) moon and sun (dissolve)", "loc. du. m. cpd."),
    g("magna-vat", "as if submerged", "adv."),
    g("tāmasī nidrā", "a dark sleep", "nom. sg. f. cpd."),
    g("babhūva", "arose, became", "3sg. pf. √bhū"),
    g("khila-gocare", "in the empty sphere", "loc. sg. m. cpd."),
]

# 1.12
GLOSSES[("vijnana-bhairava-tantra", 1, 12)] = [
    g("evam-vidhā", "of such a kind", "nom. sg. f."),
    g("bhairavasya", "of Bhairava", "gen. sg. m."),
    g("yā avasthā", "which state", "rel. nom. sg. f."),
    g("parigīyate", "is celebrated", "3sg. pres. pass."),
    g("sā parā", "she is supreme", "phrase"),
    g("para-rūpeṇa", "in the form of the Supreme", "inst. sg. n. cpd."),
    g("parā devī", "the supreme Goddess", "nom. sg. f."),
    g("prakīrtitā", "is proclaimed", "ppp. nom. sg. f."),
]

# 1.13
GLOSSES[("vijnana-bhairava-tantra", 1, 13)] = [
    g("śakti-śaktimatoḥ", "of Śakti and the holder of Śakti", "gen. du. m. cpd."),
    g("yadvat", "as much as", "adv."),
    g("abhedaḥ", "non-difference", "nom. sg. m."),
    g("sarvadā", "always", "adv."),
    g("sthitaḥ", "stands established", "ppp. nom. sg. m."),
    g("ataḥ", "therefore", "adv."),
    g("tat-dharma-dharmitvāt", "by virtue of bearing his attributes", "abl. sg. n. cpd."),
    g("parā śaktiḥ", "supreme Śakti", "nom. sg. f."),
    g("parātmanaḥ", "of the supreme Self", "gen. sg. m."),
]

# 1.14
GLOSSES[("vijnana-bhairava-tantra", 1, 14)] = [
    g("na", "not", "neg."),
    g("vahneḥ", "from fire", "gen./abl. sg. m."),
    g("dāhikā śaktiḥ", "the burning power", "nom. sg. f. cpd."),
    g("vyatiriktā", "separate", "ppp. nom. sg. f."),
    g("vibhāvyate", "is conceived", "3sg. pres. pass."),
    g("kevalam", "merely", "adv."),
    g("jñāna-sattāyām", "in the existence of knowledge", "loc. sg. f. cpd."),
    g("prārambhaḥ ayam", "this is the beginning", "phrase"),
    g("praveśane", "in the entering (i.e. the door of entry)", "loc. sg. n."),
]

# 1.15
GLOSSES[("vijnana-bhairava-tantra", 1, 15)] = [
    g("śakti-avasthā-praviṣṭasya", "for one who has entered the state of Śakti", "gen. sg. m. cpd."),
    g("nirvibhāgena", "without any division", "inst. sg. m."),
    g("bhāvanā", "is the contemplation", "nom. sg. f."),
    g("tadā", "then", "adv."),
    g("asau", "he", "nom. sg. m."),
    g("śiva-rūpī syāt", "becomes of the form of Śiva", "phrase"),
    g("śaivī", "the way of Śakti (Śaivī mukha)", "nom. sg. f."),
    g("mukham", "is the door, mouth", "nom. sg. n."),
    g("iha", "here, in this teaching", "adv."),
    g("ucyate", "is called", "3sg. pres. pass."),
]

# 1.16
GLOSSES[("vijnana-bhairava-tantra", 1, 16)] = [
    g("yathā", "just as", "adv."),
    g("ālokena dīpasya", "by the light of a lamp", "inst. sg. m. cpd."),
    g("kiraṇaiḥ bhāskarasya", "by the rays of the sun", "inst. pl. m. cpd."),
    g("ca", "and", "conj."),
    g("jñāyate", "is known", "3sg. pres. pass. √jñā"),
    g("diś-vibhāga-ādi", "the partitions of directions, etc.", "nom. sg. n. cpd."),
    g("tadvat", "in the same way", "adv."),
    g("śaktyā", "by Śakti", "inst. sg. f."),
    g("śivaḥ", "Śiva (is known)", "nom. sg. m."),
    g("priye", "O beloved", "voc. sg. f."),
]

# 1.17 — śrīdevy uvāca …
GLOSSES[("vijnana-bhairava-tantra", 1, 17)] = [
    g("śrīdevī uvāca", "the blessed Goddess said", "phrase"),
    g("devadeva", "O God of gods", "voc. sg. m."),
    g("triśūla-aṅka", "marked by the trident", "voc. sg. m. cpd."),
    g("kapāla-kṛta-bhūṣaṇa", "ornamented with skulls", "voc. sg. m. cpd."),
    g("diś-deśa-kāla-śūnyā", "free of direction, place, and time", "nom. sg. f. cpd."),
    g("ca", "and", "conj."),
    g("vyapadeśa-vivarjitā", "devoid of designation", "nom. sg. f. cpd."),
]

# 1.18
GLOSSES[("vijnana-bhairava-tantra", 1, 18)] = [
    g("yā avasthā", "which state", "rel. nom. sg. f."),
    g("bharita-ākārā", "of a filled-up nature", "nom. sg. f. cpd."),
    g("bhairavasya upalabhyate", "is apprehended in Bhairava", "phrase"),
    g("kaiḥ upāyaiḥ", "by which means?", "inst. pl. m."),
    g("mukham tasya", "is the door to him", "phrase"),
    g("parā devī", "the supreme Goddess", "nom. sg. f."),
    g("katham bhavet", "how does she come to be?", "phrase"),
    g("yathā samyak aham vedmi", "so that I rightly may know", "phrase"),
    g("tathā me brūhi bhairava", "thus tell me, O Bhairava", "phrase"),
]

# 1.19
GLOSSES[("vijnana-bhairava-tantra", 1, 19)] = [
    g("bhairavaḥ uvāca", "Bhairava said", "phrase"),
    g("ūrdhve prāṇaḥ", "above is the out-breath", "phrase"),
    g("hi", "indeed", "ptcl."),
    g("adhaḥ jīvaḥ", "below is the in-breath (jīva)", "phrase"),
    g("visarga-ātmā", "of the nature of emission (visarga)", "nom. sg. m. cpd."),
    g("para uccaret", "the Supreme should rise", "phrase"),
    g("utpatti-dvitaya-sthāne", "in the place of the two arisings", "loc. sg. n. cpd."),
    g("bharaṇāt", "from filling", "abl. sg. n."),
    g("bharitā sthitiḥ", "the fullness-state (is reached)", "phrase"),
]

# 1.20
GLOSSES[("vijnana-bhairava-tantra", 1, 20)] = [
    g("marutaḥ", "the breath, the wind", "nom. sg. m."),
    g("antaḥ bahir vā api", "either inside or outside", "phrase"),
    g("viyat-yugmā", "the pair of voids (between in- and out-breath)", "nom. sg. f. cpd."),
    g("nivartanāt", "from cessation", "abl. sg. n."),
    g("bhairavyā bhairavasya", "of Bhairavī, of Bhairava", "gen. sg. f./m."),
    g("ittham", "in this way", "adv."),
    g("bhairavi", "O Bhairavī", "voc. sg. f."),
    g("vyajyate", "is manifested", "3sg. pres. pass."),
    g("vapuḥ", "the form, body", "nom. sg. n."),
]

# 1.21
GLOSSES[("vijnana-bhairava-tantra", 1, 21)] = [
    g("na vrajet", "should not go out", "phrase"),
    g("na viśet", "nor enter", "phrase"),
    g("śaktiḥ", "the (breath-)power", "nom. sg. f."),
    g("marud-rūpā", "having the form of wind", "nom. sg. f. cpd."),
    g("vikāsite", "when expanded", "loc. sg. n. ppp."),
    g("nirvikalpatayā", "by thought-free awareness", "inst. sg. f."),
    g("madhye", "in the middle (the central state)", "loc. sg. n."),
    g("tayā", "by her", "inst. sg. f."),
    g("bhairava-rūpatā", "is identity with the form of Bhairava", "nom. sg. f. cpd."),
]

# 1.22 — kumbhita / recita / pūrita
GLOSSES[("vijnana-bhairava-tantra", 1, 22)] = [
    g("kumbhitā", "(when the breath is) retained", "ppp. nom. sg. f."),
    g("recitā", "exhaled", "ppp. nom. sg. f."),
    g("vā api", "or even", "conj."),
    g("pūritā", "inhaled, filled", "ppp. nom. sg. f."),
    g("vā", "or", "conj."),
    g("yadā bhavet", "whenever it is", "phrase"),
    g("tad-ante", "at its end", "loc. sg. m. cpd."),
    g("śāntanāmā asau", "that called the Peaceful (state)", "phrase"),
    g("śaktyā", "through that Śakti", "inst. sg. f."),
    g("śāntaḥ", "the Peaceful One", "nom. sg. m."),
    g("prakāśate", "shines forth", "3sg. pres. √kāś"),
]

# 1.23
GLOSSES[("vijnana-bhairava-tantra", 1, 23)] = [
    g("ā-mūlāt", "from the root (mūlādhāra)", "abl. sg. m."),
    g("kiraṇa-ābhāsām", "appearing as a ray", "acc. sg. f. cpd."),
    g("sūkṣmāt sūkṣmatara-ātmikām", "subtler than the subtle", "acc. sg. f. cpd."),
    g("cintayet", "one should contemplate", "3sg. opt. √cint"),
    g("tām", "her", "acc. sg. f."),
    g("dvi-ṣaṭka-ante", "at the end of the twelve (finger-breadths)", "loc. sg. m. cpd."),
    g("śāmyantīm", "(her) growing quiescent", "acc. sg. f. pres. part."),
    g("bhairava-udayaḥ", "the arising of Bhairava (occurs)", "nom. sg. m. cpd."),
]

# 1.24
GLOSSES[("vijnana-bhairava-tantra", 1, 24)] = [
    g("ud-gacchantīm", "rising upward", "acc. sg. f. pres. part."),
    g("taḍit-rūpām", "of the form of lightning", "acc. sg. f. cpd."),
    g("prati-cakram", "in each cakra", "adv."),
    g("kramāt kramam", "step by step", "adv."),
    g("ūrdhvam", "upward", "adv."),
    g("muṣṭi-traya-avadhi", "up to the limit of three fists", "adv. cpd."),
    g("yāvat", "until", "conj."),
    g("tat bhairava-udayaḥ", "that is the arising of Bhairava", "phrase"),
]

# 1.25
GLOSSES[("vijnana-bhairava-tantra", 1, 25)] = [
    g("krama-dvādaśakam", "the sequence of twelve (stations)", "acc. sg. n. cpd."),
    g("samyak", "rightly", "adv."),
    g("dvādaśa-akṣara-bheditam", "differentiated by the twelve syllables", "acc. sg. n. cpd."),
    g("sthūla-sūkṣma-para-sthityā", "by the gross, subtle, and supreme states", "inst. sg. f. cpd."),
    g("muktvā muktvā", "abandoning and abandoning (each)", "adv. ger."),
    g("antataḥ", "finally", "adv."),
    g("śivaḥ", "Śiva (is attained)", "nom. sg. m."),
]

# 1.26
GLOSSES[("vijnana-bhairava-tantra", 1, 26)] = [
    g("tayā", "by her (the rising Śakti)", "inst. sg. f."),
    g("āpūrya", "having filled", "ger. √pṛ"),
    g("āśu", "quickly", "adv."),
    g("mūrdha-antam", "to the top of the head", "acc. sg. m. cpd."),
    g("bhaṅktvā", "having broken", "ger. √bhañj"),
    g("bhrū-kṣepa-setunā", "by the bridge of raising the eyebrows", "inst. sg. m. cpd."),
    g("nirvikalpam", "free of thought-constructs", "acc. sg. n."),
    g("manaḥ kṛtvā", "having made the mind", "phrase"),
    g("sarva-ūrdhve", "in the all-above (the supreme above)", "loc. sg. m."),
    g("sarvaga-udgamaḥ", "is the rising of the All-going (Śiva)", "nom. sg. m. cpd."),
]

# 1.27 — śikhi-pakṣaiḥ … śūnya-pañcakam
GLOSSES[("vijnana-bhairava-tantra", 1, 27)] = [
    g("śikhi-pakṣaiḥ", "with peacock's feathers", "inst. pl. m. cpd."),
    g("citra-rūpaiḥ", "of variegated forms", "inst. pl. m. cpd."),
    g("maṇḍalaiḥ", "with circles", "inst. pl. m."),
    g("śūnya-pañcakam", "the pentad of voids", "acc. sg. n. cpd."),
    g("dhyāyataḥ", "for one meditating", "gen. sg. m. pres. part."),
    g("anuttare", "in the Unsurpassed (anuttara)", "loc. sg. m."),
    g("śūnye", "in the void", "loc. sg. n."),
    g("praveśaḥ", "entry", "nom. sg. m."),
    g("hṛdaye", "in the heart", "loc. sg. n."),
    g("bhavet", "may arise", "3sg. opt. √bhū"),
]

# 1.28
GLOSSES[("vijnana-bhairava-tantra", 1, 28)] = [
    g("īdṛśena krameṇa", "by such a sequence", "inst. sg. m. cpd."),
    g("eva", "alone", "ptcl."),
    g("yatra kutra api", "wherever at all", "adv."),
    g("cintanā", "contemplation (occurs)", "nom. sg. f."),
    g("śūnye", "in the void", "loc. sg. n."),
    g("kuḍye", "on a wall", "loc. sg. n."),
    g("pare", "in a supreme (object)", "loc. sg. n."),
    g("pātre", "in a vessel", "loc. sg. n."),
    g("svayam līnā", "spontaneously dissolved (the mind)", "phrase"),
    g("vara-pradā", "becomes the bestower of the boon", "nom. sg. f. cpd."),
]

# 1.29
GLOSSES[("vijnana-bhairava-tantra", 1, 29)] = [
    g("kapāla-antaḥ", "within the skull", "adv."),
    g("manaḥ nyasya", "having placed the mind", "phrase"),
    g("tiṣṭhan", "remaining", "nom. sg. m. pres. part."),
    g("mīlita-locanaḥ", "with closed eyes", "nom. sg. m. cpd."),
    g("krameṇa", "gradually", "adv."),
    g("manasaḥ dārḍhyāt", "by the firmness of the mind", "abl. sg. n. cpd."),
    g("lakṣayet", "one should perceive", "3sg. opt. caus. √lakṣ"),
    g("lakṣyam uttamam", "the highest goal", "acc. sg. n. cpd."),
]

# 1.30
GLOSSES[("vijnana-bhairava-tantra", 1, 30)] = [
    g("madhya-nāḍī", "the central channel (suṣumnā)", "nom. sg. f. cpd."),
    g("madhya-saṃsthā", "abiding in the middle", "nom. sg. f. cpd."),
    g("bisa-sūtra-ābha-rūpayā", "of a form like a lotus-fiber thread", "inst. sg. f. cpd."),
    g("dhyātā", "(being) meditated upon", "ppp. nom. sg. f."),
    g("antar-vyomayā", "with the inner void", "inst. sg. f. cpd."),
    g("devyā", "by the Goddess", "inst. sg. f."),
    g("tayā", "by her", "inst. sg. f."),
    g("devaḥ", "the God (Śiva)", "nom. sg. m."),
    g("prakāśate", "shines forth", "3sg. pres. √kāś"),
]

# 1.31
GLOSSES[("vijnana-bhairava-tantra", 1, 31)] = [
    g("kara-ruddha-dṛk-astreṇa", "with the weapon of the gaze restrained by the hand", "inst. sg. m. cpd."),
    g("bhrū-bhedāt", "by piercing the brow", "abl. sg. m. cpd."),
    g("dvāra-rodhanāt", "by blocking the doors (of the senses)", "abl. sg. n. cpd."),
    g("dṛṣṭe bindau", "when the bindu is seen", "loc. abs."),
    g("kramāt līne", "gradually dissolving", "loc. abs."),
    g("tat-madhye", "in its midst", "loc. sg. m./n."),
    g("paramā sthitiḥ", "is the supreme state", "phrase"),
]

# 1.32
GLOSSES[("vijnana-bhairava-tantra", 1, 32)] = [
    g("dhāma-antaḥ-kṣobha-sambhūta", "arisen from the agitation within the (inner) abode", "stem in cpd."),
    g("sūkṣma-agni-tilaka-ākṛtim", "the form of a subtle fire-mark (tilaka)", "acc. sg. f. cpd."),
    g("bindum", "the bindu", "acc. sg. m."),
    g("śikhā-ante", "at the tip of the flame", "loc. sg. m. cpd."),
    g("hṛdaye", "in the heart", "loc. sg. n."),
    g("laya-ante", "at the end of dissolution", "loc. sg. m. cpd."),
    g("dhyāyataḥ", "for one meditating", "gen. sg. m. pres. part."),
    g("layaḥ", "absorption (occurs)", "nom. sg. m."),
]

# 1.33
GLOSSES[("vijnana-bhairava-tantra", 1, 33)] = [
    g("anāhate", "in the unstruck (sound)", "loc. sg. n."),
    g("pātra-karṇe", "in the ear that is a fit vessel", "loc. sg. n. cpd."),
    g("abhagna-śabde", "in the unbroken sound", "loc. sg. m. cpd."),
    g("sarit-drute", "flowing like a river", "loc. sg. m. cpd."),
    g("śabda-brahmaṇi", "in the sound-brahman", "loc. sg. n. cpd."),
    g("niṣṇātaḥ", "immersed", "ppp. nom. sg. m."),
    g("param brahma", "the supreme brahman", "acc. sg. n."),
    g("adhigacchati", "attains", "3sg. pres. √gam"),
]

# 1.34
GLOSSES[("vijnana-bhairava-tantra", 1, 34)] = [
    g("praṇava-ādi-samuccārāt", "by uttering OM etc.", "abl. sg. m. cpd."),
    g("pluta-ante", "at the prolated end", "loc. sg. m. cpd."),
    g("śūnya-bhāvanāt", "by contemplating the void", "abl. sg. m. cpd."),
    g("śūnyayā parayā śaktyā", "by the supreme Power of voidness", "inst. sg. f. cpd."),
    g("śūnyatām eti", "one attains voidness", "phrase"),
    g("bhairavi", "O Bhairavī", "voc. sg. f."),
]

# 1.35
GLOSSES[("vijnana-bhairava-tantra", 1, 35)] = [
    g("yasya kasya api varṇasya", "of whichever phoneme", "gen. sg. m."),
    g("pūrva-antau", "the beginning and the end", "acc. du. m. cpd."),
    g("anubhāvayet", "one should experience", "3sg. opt. caus. √bhū"),
    g("śūnyayā", "through voidness", "inst. sg. f."),
    g("śūnya-bhūtaḥ asau", "becoming void himself", "phrase"),
    g("śūnya-ākāraḥ pumān bhavet", "the person becomes of void form", "phrase"),
]

# 1.36
GLOSSES[("vijnana-bhairava-tantra", 1, 36)] = [
    g("tantrī-ādi-vādya-śabdeṣu", "in the sounds of stringed and other instruments", "loc. pl. m. cpd."),
    g("dīrgheṣu", "prolonged", "loc. pl. m."),
    g("krama-saṃsthiteḥ", "owing to the gradual abiding (in them)", "abl. sg. f. cpd."),
    g("ananya-cetāḥ", "with mind one-pointed (not turned elsewhere)", "nom. sg. m. cpd."),
    g("pratyante", "at the end (of the sound)", "loc. sg. m."),
    g("para-vyoma-vapuḥ bhavet", "one becomes embodied as the supreme void", "phrase"),
]

# 1.37
GLOSSES[("vijnana-bhairava-tantra", 1, 37)] = [
    g("piṇḍa-mantrasya", "of a seed-mantra", "gen. sg. m. cpd."),
    g("sarvasya", "of every (mantra)", "gen. sg. m."),
    g("sthūla-varṇa-krameṇa tu", "but by the gross sequence of phonemes", "inst. sg. m. cpd."),
    g("ardha-indu-bindu-nāda-antaḥ", "the (silent) end of half-moon, bindu, and nāda", "nom. sg. m. cpd."),
    g("śūnya-uccārāt", "by voiding the utterance", "abl. sg. m. cpd."),
    g("bhavet śivaḥ", "one becomes Śiva", "phrase"),
]

# 1.38
GLOSSES[("vijnana-bhairava-tantra", 1, 38)] = [
    g("nija-dehe", "in one's own body", "loc. sg. m. cpd."),
    g("sarva-dikkam", "in all directions", "acc. sg. m. cpd."),
    g("yugapad", "simultaneously", "adv."),
    g("bhāvayet", "one should contemplate", "3sg. opt. caus. √bhū"),
    g("viyat", "the void", "acc. sg. n."),
    g("nirvikalpa-manāḥ", "with mind free of thought-constructs", "nom. sg. m. cpd."),
    g("tasya", "for him", "gen. sg. m."),
    g("viyat sarvam pravartate", "the entire void rolls forth", "phrase"),
]

# 1.39
GLOSSES[("vijnana-bhairava-tantra", 1, 39)] = [
    g("pṛṣṭha-śūnyam", "the void behind", "acc. sg. n. cpd."),
    g("mūla-śūnyam", "the void at the base", "acc. sg. n. cpd."),
    g("yugapad bhāvayet", "should simultaneously contemplate", "phrase"),
    g("ca", "and", "conj."),
    g("yaḥ", "whoever", "nom. sg. m. rel."),
    g("śarīra-nirapekṣiṇyā śaktyā", "by the Power independent of the body", "inst. sg. f. cpd."),
    g("śūnya-manāḥ bhavet", "becomes void-minded", "phrase"),
]

# 1.40
GLOSSES[("vijnana-bhairava-tantra", 1, 40)] = [
    g("pṛṣṭha-śūnyam", "void behind", "acc. sg. n. cpd."),
    g("mūla-śūnyam", "void at the base", "acc. sg. n. cpd."),
    g("hṛt-śūnyam", "void in the heart", "acc. sg. n. cpd."),
    g("bhāvayet sthiram", "should contemplate steadily", "phrase"),
    g("yugapad", "simultaneously", "adv."),
    g("nirvikalpatvāt", "from being thought-free", "abl. sg. n."),
    g("nirvikalpa-udayaḥ tataḥ", "the arising of the thought-free state follows", "phrase"),
]

# 1.41
GLOSSES[("vijnana-bhairava-tantra", 1, 41)] = [
    g("tanu-deśe", "in some region of the body", "loc. sg. m. cpd."),
    g("śūnyatā eva", "voidness alone", "phrase"),
    g("kṣaṇa-mātram", "for just a moment", "acc. sg. n. cpd."),
    g("vibhāvayet", "one should contemplate", "3sg. opt. caus. √bhū"),
    g("nirvikalpam", "thought-free", "acc. sg. n."),
    g("nirvikalpaḥ", "(becomes) thought-free", "nom. sg. m."),
    g("nirvikalpa-svarūpa-bhāk", "a sharer in the thought-free nature", "nom. sg. m. cpd."),
]

# 1.42
GLOSSES[("vijnana-bhairava-tantra", 1, 42)] = [
    g("sarvam deha-gatam dravyam", "every substance in the body", "phrase"),
    g("viyad-vyāptam", "as pervaded by the void", "acc. sg. n. cpd."),
    g("mṛga-īkṣaṇe", "O doe-eyed one", "voc. sg. f. cpd."),
    g("vibhāvayet", "one should contemplate", "3sg. opt. caus. √bhū"),
    g("tataḥ tasya", "thereupon for him", "phrase"),
    g("bhāvanā sā", "that contemplation", "phrase"),
    g("sthirā bhavet", "becomes steady", "phrase"),
]

# 1.43
GLOSSES[("vijnana-bhairava-tantra", 1, 43)] = [
    g("deha-antare", "within the body", "loc. sg. m. cpd."),
    g("tvak-vibhāgam", "the partition of the skin", "acc. sg. m. cpd."),
    g("bhitti-bhūtam", "as if a wall", "acc. sg. n. cpd."),
    g("vicintayet", "one should contemplate", "3sg. opt. √cint"),
    g("na kiñcid antare tasya", "for him, nothing is inside", "phrase"),
    g("dhyāyan", "while meditating", "nom. sg. m. pres. part."),
    g("adhyeya-bhāk bhavet", "becomes a sharer in the un-meditatable", "phrase"),
]

# 1.44
GLOSSES[("vijnana-bhairava-tantra", 1, 44)] = [
    g("hṛd-ākāśe", "in the space of the heart", "loc. sg. n. cpd."),
    g("nilīna-akṣaḥ", "with senses absorbed", "nom. sg. m. cpd."),
    g("padma-sampuṭa-madhya-gaḥ", "abiding within the closed-lotus calyx", "nom. sg. m. cpd."),
    g("ananya-cetāḥ", "with one-pointed mind", "nom. sg. m. cpd."),
    g("su-bhage", "O fortunate one", "voc. sg. f. cpd."),
    g("param saubhāgyam āpnuyāt", "would obtain the supreme good-fortune", "phrase"),
]

# 1.45
GLOSSES[("vijnana-bhairava-tantra", 1, 45)] = [
    g("sarvataḥ", "on all sides", "adv."),
    g("sva-śarīrasya", "of one's own body", "gen. sg. n. cpd."),
    g("dvādaśa-ante", "at the twelve-end (dvādaśānta)", "loc. sg. m. cpd."),
    g("manas-layāt", "by absorption of the mind", "abl. sg. m. cpd."),
    g("dṛḍha-buddheḥ", "for one of firm intellect", "gen. sg. m. cpd."),
    g("dṛḍhī-bhūtam", "becomes firmly established", "ppp. nom. sg. n."),
    g("tattva-lakṣyam", "the goal of Reality", "nom. sg. n. cpd."),
    g("pravartate", "rolls forth", "3sg. pres. √vṛt"),
]

# 1.46
GLOSSES[("vijnana-bhairava-tantra", 1, 46)] = [
    g("yathā tathā", "in whatever way", "adv."),
    g("yatra tatra", "in whatever place", "adv."),
    g("dvādaśa-ante", "at the dvādaśānta", "loc. sg. m. cpd."),
    g("manaḥ kṣipet", "one should cast the mind", "phrase"),
    g("prati-kṣaṇam", "moment by moment", "adv."),
    g("kṣīṇa-vṛtteḥ", "for him whose modifications have dwindled", "gen. sg. m. cpd."),
    g("vailakṣaṇyam", "a (luminous) distinctness", "nom. sg. n."),
    g("dinaiḥ bhavet", "comes within (a few) days", "phrase"),
]

# 1.47 — the famous "yatra yatra mano yāti" verse
GLOSSES[("vijnana-bhairava-tantra", 1, 47)] = [
    g("yatra yatra", "wherever", "adv. correlative"),
    g("manaḥ", "the mind", "nom. sg. n."),
    g("yāti", "goes", "3sg. pres. √yā"),
    g("bāhye", "outwardly", "loc. sg. n."),
    g("vā", "or", "conj."),
    g("abhyantare", "inwardly", "loc. sg. n."),
    g("api vā", "or even", "ptcl."),
    g("tatra tatra", "there, in every such place", "adv. correlative"),
    g("śiva-avasthā", "the state of Śiva (abides)", "nom. sg. f. cpd."),
    g("vyāpakatvāt", "owing to (his) all-pervasiveness", "abl. sg. n."),
    g("kva yāsyati", "where could it possibly go?", "phrase"),
]

# 1.48
GLOSSES[("vijnana-bhairava-tantra", 1, 48)] = [
    g("yatra yatra", "wherever", "adv. correlative"),
    g("akṣa-mārgeṇa", "through the path of the senses", "inst. sg. m. cpd."),
    g("caitanyam", "the Consciousness", "nom. sg. n."),
    g("vyajyate", "is manifested", "3sg. pres. pass."),
    g("vibhoḥ", "of the all-pervading (Lord)", "gen. sg. m."),
    g("tasya", "of him (the yogin)", "gen. sg. m."),
    g("tat-mātra-dharmitvāt", "since he bears only that attribute", "abl. sg. n. cpd."),
    g("cit-layāt", "from absorption into Consciousness", "abl. sg. m. cpd."),
    g("bharita-ātmatā", "comes fullness of Self", "nom. sg. f. cpd."),
]

# 1.49 — moments of intense emotion as gateways
GLOSSES[("vijnana-bhairava-tantra", 1, 49)] = [
    g("kṣut-ādi-ante", "at the end of hunger and such (urges)", "loc. sg. m. cpd."),
    g("bhaye", "in fear", "loc. sg. n."),
    g("śoke", "in grief", "loc. sg. m."),
    g("gahvare", "in a deep cavern (of doubt)", "loc. sg. m."),
    g("vā", "or", "conj."),
    g("raṇāt drute", "fleeing from battle", "loc. abs."),
    g("kutūhale", "in curiosity, in wonder", "loc. sg. m."),
    g("kṣudhā-ādi-ante", "at the end of hunger and such", "loc. sg. m. cpd."),
    g("brahma-sattā-samīpa-gā", "(one comes) near to the being of brahman", "nom. sg. f. cpd."),
]

# 1.50
GLOSSES[("vijnana-bhairava-tantra", 1, 50)] = [
    g("vastuṣu smaryamāṇeṣu", "when things are being remembered", "loc. abs."),
    g("dṛṣṭe deśe", "in the place seen", "loc. abs."),
    g("manas tyajet", "should release the mind", "phrase"),
    g("sva-śarīram", "one's own body", "acc. sg. n. cpd."),
    g("nirādhāram kṛtvā", "making (it) without support", "phrase"),
    g("prasarati prabhuḥ", "the Lord spreads forth", "phrase"),
]

# 1.51
GLOSSES[("vijnana-bhairava-tantra", 1, 51)] = [
    g("kvacit vastuni", "on some object", "loc. sg. n."),
    g("vinyasya", "having placed", "ger. √ny-as"),
    g("śanaiḥ", "gradually", "adv."),
    g("dṛṣṭim", "the gaze", "acc. sg. f."),
    g("nivartayet", "should withdraw", "3sg. opt. caus. √vṛt"),
    g("tat-jñānam", "that knowledge", "nom. sg. n. cpd."),
    g("citta-sahitam", "together with mind", "acc. sg. n. cpd."),
    g("devi", "O Goddess", "voc. sg. f."),
    g("śūnya-ālayaḥ bhavet", "(the yogin) becomes the abode of the Void", "phrase"),
]

# 1.52
GLOSSES[("vijnana-bhairava-tantra", 1, 52)] = [
    g("bhakti-udrekāt", "from an upsurge of devotion", "abl. sg. m. cpd."),
    g("viraktasya", "of one who is dispassionate", "gen. sg. m. ppp."),
    g("yādṛśī", "whatever kind of", "nom. sg. f. rel."),
    g("jāyate", "arises", "3sg. pres. √jan"),
    g("matiḥ", "thought/conviction", "nom. sg. f."),
    g("sā śaktiḥ śāṅkarī", "that is the Power of Śaṅkara", "phrase"),
    g("nityam", "always", "adv."),
    g("bhavayet tām", "one should cultivate her", "phrase"),
    g("tataḥ śivaḥ", "thence (one becomes) Śiva", "phrase"),
]

# 1.53
GLOSSES[("vijnana-bhairava-tantra", 1, 53)] = [
    g("vastu-antare", "in another object", "loc. sg. n. cpd."),
    g("vedyamāne", "when being known", "loc. abs."),
    g("sarva-vastuṣu", "in all things", "loc. pl. n. cpd."),
    g("śūnyatā", "(there is) voidness", "nom. sg. f."),
    g("tām eva", "her alone", "acc. sg. f."),
    g("manasā dhyātvā", "having contemplated with mind", "phrase"),
    g("viditaḥ api praśāmyati", "(the knower), even though known, comes to rest", "phrase"),
]

# 1.54
GLOSSES[("vijnana-bhairava-tantra", 1, 54)] = [
    g("kiñcit-jñaiḥ", "by those who know little", "inst. pl. m. cpd."),
    g("yā smṛtā śuddhiḥ", "what is regarded as purity", "phrase"),
    g("sā śuddhiḥ", "that purity", "phrase"),
    g("śambhu-darśane", "in the doctrine of Śambhu", "loc. sg. n. cpd."),
    g("na śuciḥ", "is not pure", "phrase"),
    g("hi", "indeed", "ptcl."),
    g("aśuciḥ tasmāt", "therefore impure", "phrase"),
    g("nirvikalpaḥ sukhī bhavet", "the thought-free one becomes happy", "phrase"),
]

# 1.55 — sarvatra bhairavo bhāvaḥ
GLOSSES[("vijnana-bhairava-tantra", 1, 55)] = [
    g("sarvatra", "everywhere", "adv."),
    g("bhairavaḥ bhāvaḥ", "the Being is Bhairava", "phrase"),
    g("sāmānyeṣu", "in common things", "loc. pl. n."),
    g("api", "even", "ptcl."),
    g("gocaraḥ", "is the object (of awareness)", "nom. sg. m."),
    g("na ca", "and not", "neg."),
    g("tat-vyatirekeṇa", "apart from him", "inst. sg. m. cpd."),
    g("paraḥ asti iti", "another exists — so", "phrase"),
    g("advayā gatiḥ", "is the non-dual way", "phrase"),
]

# 1.56
GLOSSES[("vijnana-bhairava-tantra", 1, 56)] = [
    g("samaḥ", "equal", "nom. sg. m."),
    g("śatrau ca mitre ca", "to enemy and to friend", "loc. sg. m."),
    g("samaḥ mānāvamānayoḥ", "equal in honor and dishonor", "phrase"),
    g("brahmaṇaḥ paripūrṇatvāt", "owing to the completeness of brahman", "abl. sg. n. cpd."),
    g("iti jñātvā", "having known thus", "phrase"),
    g("sukhī bhavet", "one becomes happy", "phrase"),
]

# 1.57
GLOSSES[("vijnana-bhairava-tantra", 1, 57)] = [
    g("na dveṣam", "no aversion", "phrase"),
    g("bhāvayet", "should cultivate", "3sg. opt. caus. √bhū"),
    g("kva api", "for anything", "adv."),
    g("na rāgam", "no attachment", "phrase"),
    g("bhāvayet", "should cultivate", "3sg. opt. caus. √bhū"),
    g("kvacit", "for anything", "adv."),
    g("rāga-dveṣa-vinirmuktau", "in freedom from attachment and aversion", "loc. sg. m. cpd."),
    g("madhye brahma", "in the middle, brahman", "phrase"),
    g("prasarpati", "creeps forth, glides in", "3sg. pres. √sṛp"),
]

# 1.58
GLOSSES[("vijnana-bhairava-tantra", 1, 58)] = [
    g("yat avedyam", "what cannot be known", "phrase"),
    g("yat agrāhyam", "what cannot be grasped", "phrase"),
    g("yat śūnyam", "what is void", "phrase"),
    g("yat abhāva-gam", "what reaches into non-existence", "phrase"),
    g("tat sarvam bhairavam", "all that is Bhairava", "phrase"),
    g("bhāvyam", "is to be contemplated", "fpp. nom. sg. n."),
    g("tad-ante", "at its end", "loc. sg. m."),
    g("bodha-sambhavaḥ", "the arising of awakening", "nom. sg. m. cpd."),
]

# 1.59
GLOSSES[("vijnana-bhairava-tantra", 1, 59)] = [
    g("nitye", "in the eternal", "loc. sg. m."),
    g("vibhau", "in the all-pervading", "loc. sg. m."),
    g("nirādhāre", "in the supportless", "loc. sg. m."),
    g("vyāpake", "in the pervasive", "loc. sg. m."),
    g("ca", "and", "conj."),
    g("akhila-ātmani", "in the Self of all", "loc. sg. m. cpd."),
    g("iti bhairavam", "on Bhairava thus", "phrase"),
    g("anusmaran", "continuously remembering", "nom. sg. m. pres. part."),
    g("pumān mucyate", "the person is liberated", "phrase"),
]

# 1.60
GLOSSES[("vijnana-bhairava-tantra", 1, 60)] = [
    g("nirādhāram", "supportless", "acc. sg. n."),
    g("saṃśayena varjitam", "free of doubt", "phrase"),
    g("khyāti-varjitam", "free of cognition (of duality)", "acc. sg. n. cpd."),
    g("brahma tat paramam", "that supreme brahman", "phrase"),
    g("proktam", "is declared", "ppp. nom. sg. n."),
    g("bhāvayet", "one should contemplate", "3sg. opt. caus. √bhū"),
    g("tan-mayaḥ bhavet", "and becomes identified with it", "phrase"),
]

# 1.61
GLOSSES[("vijnana-bhairava-tantra", 1, 61)] = [
    g("yathā tathā", "in whatever way", "adv."),
    g("upadeśena", "by instruction", "inst. sg. m."),
    g("kriyate", "is brought about", "3sg. pres. pass. √kṛ"),
    g("marutām layaḥ", "the dissolution of the breaths", "phrase"),
    g("tathā tathā", "in that very way", "adv."),
    g("manaḥ jñeyam", "the mind is to be known", "phrase"),
    g("tat-avasthā-padam vrajet", "(the yogin) goes to the seat of that state", "phrase"),
]

# 1.62
GLOSSES[("vijnana-bhairava-tantra", 1, 62)] = [
    g("a-mūlam", "rootless (the rootless source)", "acc. sg. n."),
    g("mūla-nāḍīnām", "of the root-channels", "gen. pl. f. cpd."),
    g("vāyu-pūrṇām", "filled with breath", "acc. sg. f. cpd."),
    g("suṣumṇikām", "the suṣumnā channel", "acc. sg. f."),
    g("dvādaśa-ante sthitām", "abiding at the dvādaśānta", "phrase"),
    g("dhyātvā", "having meditated", "ger. √dhyai"),
    g("a-mūlam bhairavam vrajet", "one goes to the rootless Bhairava", "phrase"),
]

# 1.63
GLOSSES[("vijnana-bhairava-tantra", 1, 63)] = [
    g("kapāla-antaḥ", "within the skull", "adv."),
    g("manaḥ tadvat", "the mind similarly (placed)", "phrase"),
    g("dhyāyataḥ", "for one meditating", "gen. sg. m. pres. part."),
    g("na cirāt", "not long thereafter", "adv."),
    g("prabho", "O Lord", "voc. sg. m."),
    g("nimīlana-ādi-jām siddhim", "attainment born of eye-closing and the rest", "phrase"),
    g("cit-mayasya", "for the one whose nature is Consciousness", "gen. sg. m. cpd."),
    g("prajāyate", "arises", "3sg. pres. √jan"),
]

# 1.64
GLOSSES[("vijnana-bhairava-tantra", 1, 64)] = [
    g("madhya-jihve", "in the middle of the tongue", "loc. sg. f. cpd."),
    g("sphārita-āsye", "with mouth opened wide", "loc. sg. m. cpd."),
    g("madhye nikṣipya", "having cast into the middle", "phrase"),
    g("cetanām", "the awareness", "acc. sg. f."),
    g("ha-uccāram", "the utterance of HA", "acc. sg. m. cpd."),
    g("manasā kurvan", "performing with the mind", "phrase"),
    g("tataḥ śānte", "thereupon, in the Peaceful (state)", "phrase"),
    g("pralīyate", "(the yogin) dissolves", "3sg. pres. pass. √lī"),
]

# 1.65
GLOSSES[("vijnana-bhairava-tantra", 1, 65)] = [
    g("āsane śayane", "while seated or lying", "loc. sg. n."),
    g("sthitvā", "having abided", "ger. √sthā"),
    g("nirādhāram", "supportless", "acc. sg. n."),
    g("vibhāvayan", "contemplating", "nom. sg. m. pres. part."),
    g("sva-deham", "one's own body", "acc. sg. m. cpd."),
    g("manasi kṣīṇe", "when the mind is dwindled", "loc. abs."),
    g("kṣaṇāt", "in a moment", "abl. sg. m."),
    g("kṣīṇa-āśayaḥ bhavet", "one becomes free of (mental) residues", "phrase"),
]

# 1.66
GLOSSES[("vijnana-bhairava-tantra", 1, 66)] = [
    g("cala-āsane", "on a moving seat", "loc. sg. n. cpd."),
    g("sthitasya atha", "for one seated, then", "phrase"),
    g("śanaiḥ vā", "or gently", "adv."),
    g("deha-cālanāt", "by shaking the body", "abl. sg. n. cpd."),
    g("praśānte mānase bhāve", "when the mental state is pacified", "loc. abs."),
    g("devi", "O Goddess", "voc. sg. f."),
    g("divya-augham", "the divine flood (of bliss)", "acc. sg. m. cpd."),
    g("āpnuyāt", "one would obtain", "3sg. opt. √āp"),
]

# 1.67
GLOSSES[("vijnana-bhairava-tantra", 1, 67)] = [
    g("ākāśam vimalam", "the unstained sky", "phrase"),
    g("paśyan", "gazing at", "nom. sg. m. pres. part."),
    g("kṛtvā dṛṣṭim nirantarām", "having made the gaze unbroken", "phrase"),
    g("stabdha-ātmā", "self-stilled", "nom. sg. m. cpd."),
    g("tat-kṣaṇāt", "at that very moment", "abl. sg. m."),
    g("devi", "O Goddess", "voc. sg. f."),
    g("bhairavam vapuḥ", "the form of Bhairava", "phrase"),
    g("āpnuyāt", "one would attain", "3sg. opt. √āp"),
]

# 1.68
GLOSSES[("vijnana-bhairava-tantra", 1, 68)] = [
    g("līnam", "dissolved", "ppp. acc. sg. n."),
    g("mūrdhni", "in the head", "loc. sg. m."),
    g("viyat", "the (sky-like) void", "acc. sg. n."),
    g("sarvam", "everything", "acc. sg. n."),
    g("bhairavatvena bhāvayet", "should contemplate as Bhairava-hood", "phrase"),
    g("tat sarvam", "all that", "phrase"),
    g("bhairava-ākāra-tejas-tattvam", "the principle of Bhairava-formed radiance", "acc. sg. n. cpd."),
    g("samāviśet", "one should fully enter", "3sg. opt. √sam-ā-viś"),
]

# 1.69
GLOSSES[("vijnana-bhairava-tantra", 1, 69)] = [
    g("kiñcit-jñātam", "the slightly-known", "acc. sg. n. cpd."),
    g("dvaita-dāyi", "duality-causing", "acc. sg. n. cpd."),
    g("bāhya-ālokaḥ", "external light", "nom. sg. m. cpd."),
    g("tamaḥ punaḥ", "and (so is) darkness again", "phrase"),
    g("viśva-ādi", "the universe and so on", "acc. sg. n. cpd."),
    g("bhairavam rūpam", "as the form of Bhairava", "phrase"),
    g("jñātvā", "having known", "ger. √jñā"),
    g("ananta-prakāśa-bhṛt", "one bears the endless light", "nom. sg. m. cpd."),
]

# 1.70
GLOSSES[("vijnana-bhairava-tantra", 1, 70)] = [
    g("evam eva", "in just this way", "adv."),
    g("dur-niśāyām", "on a moonless night", "loc. sg. f. cpd."),
    g("kṛṣṇa-pakṣa-āgame", "at the coming of the dark fortnight", "loc. sg. m. cpd."),
    g("ciram", "for long", "adv."),
    g("taimiram", "the darkness", "acc. sg. n."),
    g("bhāvayan", "contemplating", "nom. sg. m. pres. part."),
    g("rūpam bhairavam", "as the form of Bhairava", "phrase"),
    g("rūpam eṣyati", "one reaches the Form", "phrase"),
]

# 1.71
GLOSSES[("vijnana-bhairava-tantra", 1, 71)] = [
    g("evam eva", "in just this way", "adv."),
    g("nimīlya ādau", "having first closed", "phrase"),
    g("netre", "the two eyes", "acc. du. n."),
    g("kṛṣṇa-ābham", "of dark color", "acc. sg. n. cpd."),
    g("agrataḥ", "in front", "adv."),
    g("prasārya", "having spread out", "ger. √pra-sṛ"),
    g("bhairavam rūpam", "the Bhairava-form", "phrase"),
    g("bhāvayan", "contemplating", "nom. sg. m. pres. part."),
    g("tan-mayaḥ bhavet", "one becomes identified with it", "phrase"),
]

# 1.72
GLOSSES[("vijnana-bhairava-tantra", 1, 72)] = [
    g("yasya kasya indriyasya api", "of whichever sense", "phrase"),
    g("vyāghātāt", "by an obstruction", "abl. sg. m."),
    g("ca", "and", "conj."),
    g("nirodhataḥ", "by restraint", "adv."),
    g("praviṣṭasya", "of one who has entered", "gen. sg. m. ppp."),
    g("advaye śūnye", "into the non-dual void", "loc. sg. n. cpd."),
    g("tatra eva", "right there", "adv."),
    g("ātmā prakāśate", "the Self shines forth", "phrase"),
]

# 1.73
GLOSSES[("vijnana-bhairava-tantra", 1, 73)] = [
    g("a-bindum", "without the bindu", "acc. sg. m."),
    g("a-visargam", "without the visarga", "acc. sg. m."),
    g("ca", "and", "conj."),
    g("a-kāram", "the letter A", "acc. sg. m. cpd."),
    g("japataḥ", "for one reciting", "gen. sg. m. pres. part."),
    g("mahān udeti", "great (knowledge) arises", "phrase"),
    g("devi", "O Goddess", "voc. sg. f."),
    g("sahasā", "suddenly", "adv."),
    g("jñāna-oghaḥ parameśvaraḥ", "the flood of knowledge that is the Supreme Lord", "phrase"),
]

# 1.74
GLOSSES[("vijnana-bhairava-tantra", 1, 74)] = [
    g("varṇasya sa-visargasya", "of a letter with its visarga", "phrase"),
    g("visarga-antam", "to the end of the visarga", "acc. sg. m. cpd."),
    g("citim kuru", "make the consciousness", "phrase"),
    g("nirādhāreṇa cittena", "with a supportless mind", "inst. sg. n. cpd."),
    g("spṛśet brahma sanātanam", "one would touch the eternal brahman", "phrase"),
]

# 1.75
GLOSSES[("vijnana-bhairava-tantra", 1, 75)] = [
    g("vyoma-ākāram", "of the form of the void", "acc. sg. n. cpd."),
    g("svam ātmānam", "one's own Self", "acc. sg. m."),
    g("dhyāyet", "should meditate on", "3sg. opt. √dhyai"),
    g("digbhiḥ anāvṛtam", "uncovered by directions", "phrase"),
    g("nir-āśrayā", "(then) supportless", "nom. sg. f."),
    g("citiḥ śaktiḥ", "Consciousness-Power", "phrase"),
    g("sva-rūpam darśayet", "would reveal her own nature", "phrase"),
    g("tadā", "then", "adv."),
]

# 1.76
GLOSSES[("vijnana-bhairava-tantra", 1, 76)] = [
    g("kiñcit-aṅgam", "some limb", "acc. sg. n. cpd."),
    g("vibhidya ādau", "having first pierced", "phrase"),
    g("tīkṣṇa-sūcī-ādinā", "with a sharp needle or the like", "inst. sg. m. cpd."),
    g("tataḥ", "then", "adv."),
    g("tatra eva", "right there", "adv."),
    g("cetanām yuktvā", "having yoked the awareness", "phrase"),
    g("bhairave", "in Bhairava", "loc. sg. m."),
    g("nirmalā gatiḥ", "the spotless way", "phrase"),
]

# 1.77
GLOSSES[("vijnana-bhairava-tantra", 1, 77)] = [
    g("citta-ādi-antaḥkṛtiḥ", "the inner faculty beginning with citta", "nom. sg. f. cpd."),
    g("na asti", "does not exist", "phrase"),
    g("mama antaḥ", "within me", "phrase"),
    g("bhāvayet iti", "one should contemplate thus", "phrase"),
    g("vikalpānām abhāvena", "by absence of thought-constructs", "inst. sg. m. cpd."),
    g("vikalpaiḥ ujjhitaḥ bhavet", "one becomes abandoned by thought-constructs", "phrase"),
]

# 1.78
GLOSSES[("vijnana-bhairava-tantra", 1, 78)] = [
    g("māyā vimohinī nāma", "māyā called the Deluder", "phrase"),
    g("kalāyāḥ", "of kalā (limited agency)", "gen. sg. f."),
    g("kalanam", "the limiting act", "nom. sg. n."),
    g("sthitam", "stands", "ppp. nom. sg. n."),
    g("iti-ādi-dharmam", "such and similar attributes", "acc. sg. m. cpd."),
    g("tattvānām", "of the tattvas", "gen. pl. n."),
    g("kalayan", "while reckoning", "nom. sg. m. pres. part."),
    g("na pṛthag bhavet", "one would not be separate", "phrase"),
]

# 1.79
GLOSSES[("vijnana-bhairava-tantra", 1, 79)] = [
    g("jhagiti", "suddenly", "adv."),
    g("icchām samutpannām", "a desire arisen", "phrase"),
    g("avalokya", "having observed", "ger. √ava-lok"),
    g("śamam nayet", "one should lead it to quiescence", "phrase"),
    g("yataḥ eva samudbhūtā", "from where alone it arose", "phrase"),
    g("tataḥ tatra eva līyate", "there it dissolves", "phrase"),
]

# 1.80
GLOSSES[("vijnana-bhairava-tantra", 1, 80)] = [
    g("yadā mama icchā", "when my desire", "phrase"),
    g("na utpannā", "has not arisen", "phrase"),
    g("jñānam vā", "or knowledge (has not arisen)", "phrase"),
    g("kaḥ tadā asmi aham", "who am I then?", "phrase"),
    g("tattvataḥ aham tathā-bhūtaḥ", "truly I am of that nature", "phrase"),
    g("tat-līnaḥ", "absorbed in that", "nom. sg. m. cpd."),
    g("tat-manāḥ bhavet", "one becomes of that mind", "phrase"),
]

# 1.81
GLOSSES[("vijnana-bhairava-tantra", 1, 81)] = [
    g("icchāyām", "in desire", "loc. sg. f."),
    g("athavā jñāne", "or in knowledge", "phrase"),
    g("jāte", "when (it has) arisen", "loc. abs."),
    g("cittam niveśayet", "one should fix the mind", "phrase"),
    g("ātma-buddhi-ananya-cetāḥ", "with mind devoted only to Self-awareness", "nom. sg. m. cpd."),
    g("tataḥ tattva-artha-darśanam", "then comes the seeing of the reality", "phrase"),
]

# 1.82
GLOSSES[("vijnana-bhairava-tantra", 1, 82)] = [
    g("nir-nimittam", "causeless", "acc. sg. n."),
    g("bhavet jñānam", "knowledge may arise", "phrase"),
    g("nir-ādhāram", "supportless", "acc. sg. n."),
    g("bhrama-ātmakam", "delusory in nature", "acc. sg. n. cpd."),
    g("tattvataḥ kasyacit na etat", "truly this belongs to no one", "phrase"),
    g("evam-bhāvī śivaḥ priye", "(one) of such contemplation (becomes) Śiva, O beloved", "phrase"),
]

# 1.83
GLOSSES[("vijnana-bhairava-tantra", 1, 83)] = [
    g("cit-dharmā", "having Consciousness as their nature", "nom. sg. m. cpd."),
    g("sarva-deheṣu", "in all bodies", "loc. pl. m. cpd."),
    g("viśeṣaḥ na asti kutracit", "there is no distinction anywhere", "phrase"),
    g("ataḥ ca", "and from this", "phrase"),
    g("tat-mayam sarvam", "all is of that nature", "phrase"),
    g("bhāvayan", "contemplating", "nom. sg. m. pres. part."),
    g("bhava-jit janaḥ", "a person becomes conqueror of saṃsāra", "phrase"),
]

# 1.84
GLOSSES[("vijnana-bhairava-tantra", 1, 84)] = [
    g("kāma-krodha-lobha-moha-mada-mātsarya-gocare", "in the sphere of lust, anger, greed, delusion, pride, envy", "loc. sg. m. cpd."),
    g("buddhim nistimitām kṛtvā", "having made the intellect stilled", "phrase"),
    g("tat tattvam avaśiṣyate", "that Reality alone remains", "phrase"),
]

# 1.85
GLOSSES[("vijnana-bhairava-tantra", 1, 85)] = [
    g("indrajāla-mayam viśvam", "the universe (seen) as a magical display", "phrase"),
    g("vyastam", "scattered", "acc. sg. n."),
    g("vā", "or", "conj."),
    g("citra-karma-vat", "like a painting", "adv. cpd."),
    g("bhramat", "whirling", "acc. sg. n. pres. part."),
    g("vā", "or", "conj."),
    g("dhyāyataḥ", "for one meditating", "gen. sg. m. pres. part."),
    g("sarvam paśyataḥ ca", "and seeing all", "phrase"),
    g("sukha-udayaḥ", "(there is) the arising of joy", "nom. sg. m. cpd."),
]

# 1.86
GLOSSES[("vijnana-bhairava-tantra", 1, 86)] = [
    g("na cittam nikṣipet duḥkhe", "let one not cast the mind into pain", "phrase"),
    g("na sukhe vā parikṣipet", "nor into pleasure", "phrase"),
    g("bhairavi", "O Bhairavī", "voc. sg. f."),
    g("jñāyatām madhye", "let it be known in the middle", "phrase"),
    g("kim tattvam avaśiṣyate", "what reality remains?", "phrase"),
]

# 1.87
GLOSSES[("vijnana-bhairava-tantra", 1, 87)] = [
    g("vihāya", "having abandoned", "ger. √vi-hā"),
    g("nija-deha-āsthām", "attachment to one's body", "acc. sg. f. cpd."),
    g("sarvatra asmi iti", "I am everywhere — thus", "phrase"),
    g("bhāvayan", "contemplating", "nom. sg. m. pres. part."),
    g("dṛḍhena manasā", "with a firm mind", "phrase"),
    g("dṛṣṭyā", "with the gaze", "inst. sg. f."),
    g("na anya-īkṣiṇyā", "looking at nothing else", "phrase"),
    g("sukhī bhavet", "one becomes happy", "phrase"),
]

# 1.88
GLOSSES[("vijnana-bhairava-tantra", 1, 88)] = [
    g("ghaṭa-ādau", "in a pot and the like", "loc. sg. m. cpd."),
    g("yat ca vijñānam", "whatever cognition", "phrase"),
    g("icchā-ādyam vā mama antare", "or desire, etc., within me", "phrase"),
    g("na eva sarva-gatam jātam", "it is not at all become all-pervading", "phrase"),
    g("bhāvayan iti sarva-gaḥ", "one who contemplates thus becomes all-pervading", "phrase"),
]

# 1.89
GLOSSES[("vijnana-bhairava-tantra", 1, 89)] = [
    g("grāhya-grāhaka-saṃvittiḥ", "awareness of object and subject", "nom. sg. f. cpd."),
    g("sāmānyā", "is common", "nom. sg. f."),
    g("sarva-dehinām", "to all embodied beings", "gen. pl. m. cpd."),
    g("yogināṃ tu viśeṣaḥ asti", "but for yogins there is a distinction", "phrase"),
    g("sambandhe", "in the connection", "loc. sg. m."),
    g("sa-avadhānatā", "is attentiveness", "nom. sg. f. cpd."),
]

# 1.90
GLOSSES[("vijnana-bhairava-tantra", 1, 90)] = [
    g("sva-vat", "as in one's own (body)", "adv."),
    g("anya-śarīre api", "even in another's body", "phrase"),
    g("saṃvittim anubhāvayet", "one should experience the awareness", "phrase"),
    g("apekṣām sva-śarīrasya", "regard for one's own body", "phrase"),
    g("tyaktvā", "having abandoned", "ger. √tyaj"),
    g("vyāpī dinaiḥ bhavet", "in (a few) days one becomes pervasive", "phrase"),
]

# 1.91
GLOSSES[("vijnana-bhairava-tantra", 1, 91)] = [
    g("nirādhāram manaḥ kṛtvā", "having made the mind supportless", "phrase"),
    g("vikalpān na vikalpayet", "one should not construct thought-constructs", "phrase"),
    g("tadā ātma-parama-ātma-tve", "then, in the state of self-being-supreme-Self", "phrase"),
    g("bhairavaḥ mṛga-locane", "is Bhairava, O doe-eyed one", "phrase"),
]

# 1.92
GLOSSES[("vijnana-bhairava-tantra", 1, 92)] = [
    g("sarvajñaḥ", "all-knowing", "nom. sg. m."),
    g("sarva-kartā ca", "and all-doer", "phrase"),
    g("vyāpakaḥ parameśvaraḥ", "the all-pervading Supreme Lord", "phrase"),
    g("saḥ eva aham", "I am he", "phrase"),
    g("śaiva-dharmā", "having the nature of Śiva", "nom. sg. m. cpd."),
    g("iti dārḍhyāt", "from firmness in this conviction", "phrase"),
    g("śivaḥ bhavet", "one becomes Śiva", "phrase"),
]

# 1.93
GLOSSES[("vijnana-bhairava-tantra", 1, 93)] = [
    g("jalasya iva", "as of water", "phrase"),
    g("ūrmayaḥ", "(are) the waves", "nom. pl. m."),
    g("vahneḥ jvālā-bhaṅgyaḥ", "of fire, the breaks of flame", "phrase"),
    g("prabhā raveḥ", "the light of the sun", "phrase"),
    g("mama eva bhairavasya", "of me, Bhairava, alone", "phrase"),
    g("etāḥ viśva-bhaṅgyaḥ", "these are the wave-breaks of the universe", "phrase"),
    g("vibheditāḥ", "(seemingly) differentiated", "ppp. nom. pl. f."),
]

# 1.94
GLOSSES[("vijnana-bhairava-tantra", 1, 94)] = [
    g("bhrāntvā bhrāntvā", "having whirled and whirled", "ger. √bhram"),
    g("śarīreṇa", "with the body", "inst. sg. n."),
    g("tvaritam", "quickly", "adv."),
    g("bhuvi pātanāt", "by falling on the ground", "abl. sg. n."),
    g("kṣobha-śakti-virāmeṇa", "by the cessation of the agitating Power", "inst. sg. m. cpd."),
    g("parā saṃjāyate daśā", "the supreme state arises", "phrase"),
]

# 1.95
GLOSSES[("vijnana-bhairava-tantra", 1, 95)] = [
    g("ādhāreṣu", "on supports", "loc. pl. m."),
    g("athavā aśaktyā", "or through inability", "phrase"),
    g("jñānāt", "from knowledge", "abl. sg. n."),
    g("vā", "or", "conj."),
    g("deśa-kalpanāt", "from imagining a place", "abl. sg. m. cpd."),
    g("ujjāte śakti-saṃśobhe", "when the splendor of Śakti has arisen", "loc. abs."),
    g("śānte paścāt tadā bhavet", "afterward, when (it is) pacified, then (the supreme state) arises", "phrase"),
]

# 1.96 (duplicate of 1.114) — upaviśya āsane samyag
GLOSSES[("vijnana-bhairava-tantra", 1, 96)] = [
    g("upaviśya", "having sat down", "ger. √upa-viś"),
    g("āsane samyak", "rightly on a seat", "phrase"),
    g("bāhū kṛtvā", "having made the arms", "phrase"),
    g("ardha-kuñcitau", "half-bent", "acc. du. m. cpd."),
    g("kakṣa-vyomni", "in the void of the armpits", "loc. sg. n. cpd."),
    g("manaḥ kurvan", "placing the mind", "phrase"),
    g("śamam āyāti", "(one) comes to peace", "phrase"),
    g("tat-layāt", "by absorption in that", "abl. sg. m."),
]

# 1.97 (duplicate of 1.115)
GLOSSES[("vijnana-bhairava-tantra", 1, 97)] = [
    g("sthūla-rūpasya bhāvasya", "of a gross-formed object", "phrase"),
    g("stabdhām dṛṣṭim nipātya", "having cast a steady gaze", "phrase"),
    g("ca", "and", "conj."),
    g("acireṇa", "soon", "adv."),
    g("nirādhāram manaḥ kṛtvā", "having made the mind supportless", "phrase"),
    g("śivam vrajet", "one goes to Śiva", "phrase"),
]

# 1.98 (duplicate of 1.116)
GLOSSES[("vijnana-bhairava-tantra", 1, 98)] = [
    g("madhya-jihve", "in the middle of the tongue", "loc. sg. f. cpd."),
    g("sphārita-āsye", "with mouth opened wide", "loc. sg. m. cpd."),
    g("madhye nikṣipya cetanām", "casting awareness in the middle", "phrase"),
    g("uccaran manasā mantram", "uttering the mantra mentally", "phrase"),
    g("śivaḥ dhyāyan", "meditating on Śiva", "phrase"),
    g("praśāmyati", "(the yogin) comes to perfect rest", "3sg. pres. √śam"),
]

# 1.108 — taste / aesthetic experience
GLOSSES[("vijnana-bhairava-tantra", 1, 108)] = [
    g("gītā-ādi-viṣaya-āsvāda-asama-saukhya-ekatā-ātmanaḥ", "of one whose nature is the singular bliss of relishing song, etc.", "gen. sg. m. cpd."),
    g("yoginaḥ", "for the yogin", "gen. sg. m."),
    g("tan-mayatvena", "by identification with that", "inst. sg. n. cpd."),
    g("manaḥ-rūḍheḥ", "owing to the ascent of the mind", "abl. sg. f. cpd."),
    g("tat-ātmatā", "is identity with That", "nom. sg. f. cpd."),
]

# 1.109
GLOSSES[("vijnana-bhairava-tantra", 1, 109)] = [
    g("yatra yatra", "wherever", "adv. correlative"),
    g("ātmanaḥ tuṣṭiḥ", "satisfaction of the Self (occurs)", "phrase"),
    g("manaḥ", "the mind", "nom. sg. n."),
    g("tatra eva", "right there", "adv."),
    g("dhārayet", "one should hold", "3sg. opt. √dhṛ"),
    g("tatra tatra", "there, in every such place", "adv. correlative"),
    g("para-ānanda-svarūpam", "the own-nature of supreme bliss", "nom. sg. n. cpd."),
    g("sampravartate", "rolls forth fully", "3sg. pres. √vṛt"),
]

# 1.110
GLOSSES[("vijnana-bhairava-tantra", 1, 110)] = [
    g("anāgatāyām nidrāyām", "when sleep has not yet come", "loc. abs."),
    g("pranaṣṭe bāhya-gocare", "when the external sphere has vanished", "loc. abs."),
    g("sā avasthā", "that state", "phrase"),
    g("manasā gamyā", "is to be reached by the mind", "phrase"),
    g("parā devī prakāśate", "the supreme Goddess shines forth", "phrase"),
]

# 1.111
GLOSSES[("vijnana-bhairava-tantra", 1, 111)] = [
    g("tejasā", "with light", "inst. sg. n."),
    g("sūrya-dīpa-ādeḥ", "of the sun, a lamp, etc.", "gen. sg. m. cpd."),
    g("ākāśe śabalī-kṛte", "when the space has been variegated", "loc. abs."),
    g("dṛṣṭe sva-ātmani", "when one's own Self is seen", "loc. abs."),
    g("bhā-yukte", "endowed with that radiance", "loc. sg. m. cpd."),
    g("sat-cit-ānanda-gocaraḥ", "(arises) the sphere of being-consciousness-bliss", "nom. sg. m. cpd."),
]

# 1.112 — the four śaktis
GLOSSES[("vijnana-bhairava-tantra", 1, 112)] = [
    g("karaṅkiṇyā", "by Karaṅkiṇī", "inst. sg. f."),
    g("krodhanayā", "by Krodhanā", "inst. sg. f."),
    g("bhairavyā", "by Bhairavī", "inst. sg. f."),
    g("lelihānayā", "by Lelihānā", "inst. sg. f."),
    g("khecaryā", "by Khecarī", "inst. sg. f."),
    g("dṛṣṭi-kāle", "at the time of the gaze", "loc. sg. m. cpd."),
    g("ca", "and", "conj."),
    g("para-āvāptiḥ", "the supreme attainment", "nom. sg. f. cpd."),
    g("prakāśate", "shines forth", "3sg. pres. √kāś"),
]

# 1.113
GLOSSES[("vijnana-bhairava-tantra", 1, 113)] = [
    g("mṛdu-āsane", "on a soft seat", "loc. sg. n. cpd."),
    g("sphijā ekena", "with a single hip (uneven seat)", "phrase"),
    g("hasta-pādau nir-āśrayau", "the hand and foot without support", "phrase"),
    g("nidhāya", "having placed", "ger. √ni-dhā"),
    g("tat-prasaṅgena", "by virtue of this", "inst. sg. m."),
    g("parā pūrṇā matiḥ bhavet", "supreme full insight arises", "phrase"),
]

# 1.149
GLOSSES[("vijnana-bhairava-tantra", 1, 149)] = [
    g("yasya kasya api dehe asmin", "of whoever, in this body", "phrase"),
    g("pratyayaḥ aham-kṛtaḥ bhavet", "the conviction 'I am' arises", "phrase"),
    g("tasya eva", "for him alone", "phrase"),
    g("kṣudra-saṃvitteḥ", "from a tiny awareness", "abl. sg. f. cpd."),
    g("bhairavatvam prakāśate", "Bhairava-hood shines forth", "phrase"),
]

# 1.150
GLOSSES[("vijnana-bhairava-tantra", 1, 150)] = [
    g("śrīdevī uvāca", "the blessed Goddess said", "phrase"),
    g("devadeva mahādeva", "O God of gods, Great God", "voc. cpd."),
    g("paripūrṇaḥ asi me prabho", "you are wholly fulfilled for me, O Lord", "phrase"),
    g("śaṅkarasya tvam eva ātmā", "you alone are the Self of Śaṅkara", "phrase"),
    g("śaktiḥ jagati śāśvatī", "the eternal Power in the world", "phrase"),
]

# 1.151
GLOSSES[("vijnana-bhairava-tantra", 1, 151)] = [
    g("yathā tvayā kṛpā-āviṣṭam", "as, filled with grace by you", "phrase"),
    g("idam rahasyam", "this secret", "phrase"),
    g("uddhṛtam", "(has been) revealed", "ppp. nom. sg. n."),
    g("tathā eva", "in that same way", "adv."),
    g("kasya api vacyam", "to anyone it is to be spoken (cautiously)", "phrase"),
    g("śrotre pātre", "into a fitting ear", "loc. sg. n."),
    g("na tat kṣipet", "should not cast it", "phrase"),
]

# 1.152
GLOSSES[("vijnana-bhairava-tantra", 1, 152)] = [
    g("idam vijñānam", "this gnosis", "phrase"),
    g("uditam", "has arisen", "ppp. nom. sg. n."),
    g("jarā-maraṇa-nāśanam", "destroyer of old age and death", "nom. sg. n. cpd."),
    g("brahma-ādi-deva-vandyasya", "of the one venerated by Brahmā and the gods", "gen. sg. m. cpd."),
    g("manthāna-bhairavasya", "of Manthāna-Bhairava", "gen. sg. m."),
    g("ca", "and", "conj."),
]

# 1.153
GLOSSES[("vijnana-bhairava-tantra", 1, 153)] = [
    g("anākhyātam idam tantram", "this is the unspoken Tantra", "phrase"),
    g("bhoga-mokṣa-vidhāyakam", "bestower of enjoyment and liberation", "nom. sg. n. cpd."),
    g("anākhyātam idam tantram", "this unspoken Tantra", "phrase"),
    g("tebhyaḥ dattam", "is given to them", "phrase"),
    g("hi līlayā", "indeed, as a play", "adv."),
]

# 1.156
GLOSSES[("vijnana-bhairava-tantra", 1, 156)] = [
    g("evam vijñānam ālambya", "relying on this gnosis", "phrase"),
    g("yoginaḥ jāyate śivaḥ", "the yogin becomes Śiva", "phrase"),
    g("tīrtha-ādiṣu", "in pilgrimage places, etc.", "loc. pl. n. cpd."),
    g("ca jātyaḥ api", "even if of (some) caste-birth", "phrase"),
    g("snāna-ādiṣu na kāraṇam", "in bathing etc., (there is) no requirement", "phrase"),
]

# 1.163 — colophon
GLOSSES[("vijnana-bhairava-tantra", 1, 163)] = [
    g("iti vijñāna-bhairave", "thus in the Vijñāna Bhairava", "phrase"),
    g("śrīdevyā stavana-ātmakam", "consisting of the praise by the Goddess", "phrase"),
    g("śatam ekam", "one hundred", "phrase"),
    g("dvādaśa-adhikam", "with twelve added", "adj. cpd."),
    g("uktam", "is declared", "ppp. nom. sg. n."),
    g("bheda-vivarjitam", "free of division", "acc. sg. n. cpd."),
]


# ─────────────────────────────────────────────────────────────────────────────
# Spanda Kārikās — backfill a handful that are particularly thin
# (most are already at 5+ glosses; we expand opening verses only)
# ─────────────────────────────────────────────────────────────────────────────

# 1.2 — yatra sthitam idaṃ sarvam ...
GLOSSES[("spanda-karikas", 1, 2)] = [
    dg("यत्र", "yatra", "in whom", "loc. rel."),
    dg("स्थितम्", "sthitam", "stands established", "ppp. nom. sg. n."),
    dg("इदं सर्वम्", "idaṃ sarvam", "all this", "nom. sg. n."),
    dg("कार्यम्", "kāryam", "effect, the to-be-done", "nom. sg. n."),
    dg("यस्मात्", "yasmāt", "from whom", "abl. rel."),
    dg("च निर्गतम्", "ca nirgatam", "and (everything) has issued forth", "phrase"),
    dg("तस्य", "tasya", "for him", "gen. sg. m."),
    dg("अनावृत-रूपत्वात्", "anāvṛta-rūpatvāt", "owing to (his) uncovered nature", "abl. sg. n. cpd."),
    dg("न निरोधः अस्ति", "na nirodhaḥ asti", "there is no obstruction", "phrase"),
    dg("कुत्रचित्", "kutracit", "anywhere", "indef. adv."),
]

GLOSSES[("vijnana-bhairava-tantra", 1, 109)] = [
    g("yatra yatra", "wherever", "adv. correlative"),
    g("ātmanaḥ tuṣṭiḥ", "satisfaction of the Self (occurs)", "phrase"),
    g("manaḥ", "the mind", "nom. sg. n."),
    g("tatra eva", "right there", "adv."),
    g("dhārayet", "one should hold", "3sg. opt. √dhṛ"),
    g("tatra tatra", "there, in every such place", "adv. correlative"),
    g("para-ānanda-svarūpam", "the own-nature of supreme bliss", "nom. sg. n. cpd."),
    g("sampravartate", "rolls forth fully", "3sg. pres. √vṛt"),
]

# 1.155 — close echo of 1.47
GLOSSES[("vijnana-bhairava-tantra", 1, 155)] = [
    g("yatra yatra", "wherever", "adv. correlative"),
    g("kathañcit tu", "in any manner whatsoever", "adv."),
    g("kartṛ-karma-viviktatā", "discrimination of agent from action arises", "nom. sg. f. cpd."),
    g("tatra tatra", "there, in every such case", "adv. correlative"),
    g("śiva-avasthā", "the state of Śiva", "nom. sg. f. cpd."),
    g("vyāpakatvāt", "owing to (his) all-pervasiveness", "abl. sg. n."),
    g("kva yāsyati", "where could it possibly go?", "phrase"),
]


# ─────────────────────────────────────────────────────────────────────────────
# Śiva Sūtras — expand only the longer ones; keep short aphorisms untouched
# ─────────────────────────────────────────────────────────────────────────────
# The Śiva Sūtras are largely 2–4 word aphorisms. Most are already correctly
# glossed at 2 entries. We expand a handful of longer ones below.

# We deliberately leave most short sūtras alone (they really are 2-word).

# 1.5 — udyamo bhairavaḥ — already 2 glosses, that is correct
# 1.10 — mohāvaraṇāt siddhiḥ — leave
# 1.20 — bhūta-saṃdhāna-bhūta-pṛthaktva-viśva-saṃghaṭṭāḥ
GLOSSES[("siva-sutras", 1, 20)] = [
    g("bhūta-saṃdhāna", "joining the elements (to their essence)", "stem in cpd."),
    g("bhūta-pṛthaktva", "separating the elements (from disease etc.)", "stem in cpd."),
    g("viśva-saṃghaṭṭāḥ", "and the conjoinings of (parts of) the world (= the siddhis)", "nom. pl. m. cpd."),
]

# 2.7 — mātṛkā-cakra-saṃbodhaḥ
GLOSSES[("siva-sutras", 2, 7)] = [
    g("mātṛkā-cakra", "the wheel of mātṛkā (the alphabet-goddess)", "stem in cpd."),
    g("saṃbodhaḥ", "(comes) the full awakening", "nom. sg. m."),
]

# 3.27 — kathā japaḥ
GLOSSES[("siva-sutras", 3, 27)] = [
    g("kathā", "talk (the yogin's speech)", "nom. sg. f."),
    g("japaḥ", "becomes japa (mantric recitation)", "nom. sg. m."),
]
