/**
 * en.ts — single source of truth for site-chrome UI strings.
 *
 * Architecture:
 *   - SSR always renders English (this file). Every visible chrome string
 *     in an in-scope component is rendered with the same `data-i18n="key"`
 *     attribute so the client-side I18nSwap island can rewrite the DOM
 *     when the reader-lang ≠ 'en'.
 *   - Companion JSON dictionaries (`./hi.json`, `./ta.json`, …) ship the
 *     translated copy for each of the 11 non-English reading languages.
 *     Missing keys fall back to the English value below.
 *   - This is the canonical key list. The 11 translation agents fan out
 *     against THIS file — never freelance keys.
 *
 * Conventions:
 *   - Keys are dot-namespaced by surface (e.g. `masthead.search.aria`,
 *     `footer.link.sources`, `subscribe.heading`).
 *   - Values are verbatim the strings rendered in the existing components
 *     — extracting MUST be byte-identical for the English visitor.
 *   - Strings with dynamic interpolation (e.g. "All texts (N)") are
 *     split: the static prefix lives here, the dynamic suffix is a bare
 *     sibling in the JSX.
 *
 * Out of Phase A scope (deferred to V1.x Phase B):
 *   - The about/*.astro long-form prose.
 *   - daily / dataset / donate / cite / sample / search long-form copy.
 *   - Solid components' internal strings (ScriptSwitcher dialog header
 *     "Reading mode", SettingsSheet section labels, WordSheet labels,
 *     TranslationDrawer labels). TODO entries are commented below so
 *     Phase B can pick up the canonical key shape without re-keying.
 */

export const en = {
  // ── Skip link (BaseLayout.astro) ───────────────────────────────────────
  'skip.to_content': 'Skip to content',

  // ── Masthead (Masthead.astro) ──────────────────────────────────────────
  'masthead.search.aria': 'Search verses, words, or concepts',
  // Note: `masthead.lang.aria` was retired alongside Masthead's switch to
  // `picker.translation_language` — the catalogue picker has one canonical
  // i18n key now, used by every surface (audit-2026-06-01 rec #4).
  'masthead.lang.soon': 'soon',
  'masthead.lang.soon_title': 'Translation coming soon — see methodology',

  // ── Picker (cross-surface — Masthead chip, ScriptSwitcher trigger, ──
  // TranslationDrawer trigger). Canonical name for the action "choose
  // which language the translation + glosses render in." Reserve "Script"
  // for the Sanscript-driven writing-system choice; this catalogue does
  // both in one motion (see src/lib/reading-modes.ts) but the user
  // language is the load-bearing concept.
  'picker.translation_language': 'Translation language',

  // ── Footer (Footer.astro) ──────────────────────────────────────────────
  'footer.link.sources': 'Sources',
  'footer.link.methodology': 'Methodology',
  'footer.link.license': 'License (CC-BY-SA 4.0)',
  'footer.link.github': 'GitHub',
  'footer.link.dataset': 'Zenodo dataset',
  'footer.link.donate': 'Donate',
  'footer.link.privacy': 'Privacy',
  'footer.link.colophon': 'Colophon',
  // The attribution paragraph is sentence-stitched in the component
  // around three source <a>s. Translators see the full sentence + the
  // anchor labels as separate keys; the component re-stitches them.
  'footer.attribution.prefix': 'sohamhamso is a non-profit project. Sanskrit sources from',
  'footer.attribution.source_gretil': 'GRETIL',
  'footer.attribution.source_muktabodha': 'Muktabodha (MIRI)',
  'footer.attribution.source_sanskritdocuments': 'sanskritdocuments.org',
  'footer.attribution.middle':
    'under their respective licenses. AI-assisted translations not human-verified — see',
  'footer.attribution.methodology_link': 'methodology',
  'footer.attribution.suffix': '.',
  'footer.doi.label': 'DOI',
  'footer.doi.cite_aria_prefix': 'Cite this release: DOI',

  // ── SubscribeBand (SubscribeBand.astro) ────────────────────────────────
  'subscribe.heading': 'Receive a verse at dawn.',
  'subscribe.sub': 'One verse, one translation. No commentary. Unsubscribe anytime.',
  'subscribe.email.label': 'Email address',
  'subscribe.email.placeholder': 'your email',
  'subscribe.lang.soon_suffix': ' (soon)',
  'subscribe.lang.soon_title': 'Coming soon — see methodology',
  'subscribe.button': 'subscribe',
  'subscribe.status.pending': 'Subscribing…',
  'subscribe.status.success': "You're subscribed. The first verse arrives at sunrise.",
  'subscribe.status.error': "Couldn't subscribe. Try again or email us.",

  // ── FeaturedVerseHero (FeaturedVerseHero.astro) ────────────────────────
  // Citation label and verse content are corpus, not chrome; left untouched.
  'hero.read': 'Read',

  // ── CuratedEntries (CuratedEntries.astro) ──────────────────────────────
  'curated.aria': 'Where to begin',
  'curated.if_new.title': 'If you are new',
  'curated.if_new.description': 'Begin with the Śiva Sūtras — 77 aphorisms.',
  'curated.daily.title': 'Daily readings',
  'curated.daily.description': 'A verse at dawn in your inbox.',
  // "All texts (N)" — static prefix; the parenthesized count is a bare
  // sibling so the dynamic substitution survives the swap.
  'curated.all_texts.title': 'All texts',
  'curated.all_texts.description': 'Browse the full corpus.',

  // ── FeaturedNewText (FeaturedNewText.astro) ────────────────────────────
  // Only the static "New" label — the title/descriptor are per-launch
  // editorial copy living in src/lib/featured-text.ts, not chrome.
  'featured.new_label': 'New',

  // ── KaulaContentAdvisory (KaulaContentAdvisory.astro) ──────────────────
  'kaula.aria': 'Scholarly access notice',
  'kaula.title': 'Scholarly access',
  'kaula.body':
    'These texts traditionally require dīkṣā (initiation) and lineage transmission for full study. They are published here for scholarly access. Engage with appropriate context.',

  // ── AIAssistedBadge (AIAssistedBadge.astro) ────────────────────────────
  // Only the PURE-static labels — the composed forms
  //   "AI · reviewed by {name}"  and  "{translator} · {year} · PD"
  // are dynamic and stay un-swapped. computeBadgeState() builds those.
  'badge.ai.not_verified': 'AI · not verified',
  'badge.ai.reviewed': 'AI · reviewed',
  'badge.public_domain': 'Public domain',
  'badge.dl.translator': 'Translator',
  'badge.dl.model': 'Model',
  'badge.dl.prompt': 'Prompt',
  'badge.dl.reviewer': 'Reviewer',
  'badge.dl.generated': 'Generated',
  'badge.dl.status': 'Status',
  'badge.how_we_translate': 'How we translate →',

  // ── ParallelChip (ParallelChip.astro) ──────────────────────────────────
  // "parallels (N)" — split static prefix from the count sibling.
  'parallels.label': 'parallels',
  'parallels.confidence_prefix': 'confidence',
  'parallels.fallback_title': 'Parallel verse',

  // ── VerseAnatomy (VerseAnatomy.astro) ──────────────────────────────────
  // Chrome only — NEVER the Devanāgarī / IAST / synonyms / translation
  // (those are corpus, swapped by ReaderLangSwap).
  'verse.number_aria_prefix': 'Verse',
  'verse.meter_aria': 'meter',
  'verse.synonyms_aria': 'word-by-word synonyms',
  'verse.alt_translations_aria': 'additional translations',
  'verse.manuscript_prefix': 'View manuscript at',
  'verse.manuscript_folio_prefix': 'folio',
  // Prose blocks (section_type='prose', plan A4): the rail aria-prefix
  // reads "Block" and the collapsed-by-default IAST <details> carries a
  // summary label. Same Phase-B caveat as `verse.number_aria_prefix` for
  // the locator-bearing aria-label.
  'verse.block_aria_prefix': 'Block',
  'verse.prose_iast_summary': 'Transliteration (IAST)',

  // ── Verse page chrome ([verse].astro) ──────────────────────────────────
  'verse_page.back_aria': 'Back to text',
  'verse_page.settings_aria': 'Reading settings',
  'verse_page.nav_aria': 'Verse navigation',
  // Prose wayfinding: nav landmark + prev/next read passage, not verse.
  'verse_page.nav_aria_passage': 'Passage navigation',
  'verse_page.prev_verse_aria': 'Previous verse',
  'verse_page.next_verse_aria': 'Next verse',
  'verse_page.prev_passage_aria': 'Previous passage',
  'verse_page.next_passage_aria': 'Next passage',

  // ── Text overview page ([text]/index.astro) ────────────────────────────
  'text_overview.home_aria': 'Home',
  'text_overview.by_prefix': 'by',
  'text_overview.verses_suffix': 'verses',
  'text_overview.chapter_suffix': 'chapter',
  'text_overview.chapters_suffix': 'chapters',
  'text_overview.table.chapter': 'Chapter',
  'text_overview.table.verses': 'Verses',
  // Column header for prose texts (any section_type='prose' blocks).
  'text_overview.table.passages': 'Passages',
  'text_overview.table.read': 'Read',
  'text_overview.read_chapter_prefix': 'Read chapter',
  'text_overview.source_prefix': 'Source:',
  'text_overview.license_prefix': 'License:',
  'text_overview.view_manuscript': 'View manuscript ↗',

  // ── Tradition overview page ([tradition]/index.astro) ──────────────────
  'tradition.home_aria': 'Home',
  'tradition.text_suffix': 'text',
  'tradition.texts_suffix': 'texts',
  'tradition.verses_suffix': 'verses',
  'tradition.table.text': 'Text',
  'tradition.table.author': 'Author',
  'tradition.table.verses': 'Verses',
  'tradition.table.read': 'Read',
  'tradition.open': 'Open →',

  // ── /texts index (texts/index.astro) ───────────────────────────────────
  'texts.eyebrow': 'Corpus',
  'texts.title': 'All texts',
  // Lede is sentence-stitched around the count + the methodology anchor;
  // the component re-stitches `lede.prefix + count + lede.middle + <a> + lede.suffix`.
  'texts.lede.prefix_text':
    'text, flat alphabetical. Translations in eleven Indic languages are AI-assisted and not yet human-verified — see',
  'texts.lede.prefix_texts':
    'texts, flat alphabetical. Translations in eleven Indic languages are AI-assisted and not yet human-verified — see',
  'texts.lede.methodology': 'methodology',
  'texts.lede.suffix': '.',
  'texts.table.text': 'Text',
  'texts.table.tradition': 'Tradition',
  'texts.table.verses': 'Verses',
  'texts.table.license': 'License',

  // ── TODO Phase B (commented for the next translation pass) ─────────────
  // The ScriptSwitcher trigger label + sheet title and the TranslationDrawer
  // sheet title now share `picker.translation_language` above — when Phase B
  // wires Solid-island i18n, reuse that key (no per-component duplicate).
  // 'settings.section.theme': 'Theme',
  // 'settings.section.font_size': 'Font size',
  // 'settings.section.script': 'Script',
  // 'wordsheet.heading': 'Word',
  // 'wordsheet.morph_label': 'Morphology',
  // 'wordsheet.more_occurrences': 'more occurrences →',
  // 'translation_drawer.empty': 'Not yet translated to',
} as const;

/** Union of every chrome i18n key. */
export type I18nKey = keyof typeof en;

/** Runtime read-only view of the EN dictionary. */
export const EN_DICT: Readonly<Record<string, string>> = en;
