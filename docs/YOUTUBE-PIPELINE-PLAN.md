# Plan: sohamhamso.org YouTube Shorts Pipeline

## Context

sohamhamso.org has shipped SEO infrastructure for 12 locales and is now indexed by GSC + Bing. The corpus (149 clean-license verses across Siva Sutras, Spanda Karikas, Pratyabhijna Hrdayam) has translated text in 12 languages already stored in SQLite + queryable via `src/lib/db.ts::getVerseAllLanguages()`. To drive discovery + backlinks beyond search engines, build a pipeline that turns every verse into 12 short YouTube videos — one per language — using Google Cloud TTS WaveNet to read the translation aloud, Remotion to render text-on-color visuals, and two scheduled crons to separate generation from deployment.

**MVP scope (Phase 1): 149 English-only videos** (Siva Sutras 77 + Spanda Karikas 52 + Pratyabhijna Hrdayam 20). Indic languages deferred to Phase 2, gated on 30-day pilot data clearing the kill-switch thresholds below. Full theoretical scope (1,788 videos = 149 × 12) is the long-run target only if Phase 1 validates.

This revision per autoplan review: CEO challenged the full 1,788 scope as content-factory-before-validation; Eng + DX flagged the input_hash keystone + Cron C review queue as over-built for unvalidated scope; user accepted CEO Challenge 2 (English-first), rejected Challenges 1 (keep 12-vids-per-verse pipeline design for future) + 3 (keep @sohamhamso channel).

## Locked Decisions

1. **No Sanskrit chant** — Sanskrit appears on screen (Devanagari + IAST) but is never spoken. Audio is the translation read aloud in the lang of the video.
2. **Phase 1: English only (149 videos)**. Schema + pipeline retain 12-lang support throughout — `videos.lang` column stays, the design fan-out per verse stays. Indic implementation is gated on kill-switch thresholds at day 30 of Phase 1 (see Kill Switch section below).
3. **TTS**: Google Cloud TTS WaveNet for English (Phase 1). Hybrid Google + Azure activation deferred to Phase 2: Google WaveNet for 9 langs (hi, ta, bn, mr, gu, kn, ml, pa) + Google Chirp3-HD for te (no SSML phoneme support, accepted gap) + Azure Cognitive Speech Neural for or/as (`or-IN-{Subhasini,Sukant}Neural`, `as-IN-{Yashica,Priyom}Neural`).
4. **Remotion** for render (React-based, JSX templates).
5. **Two-cron architecture** — generation cron writes to R2 first; deployment cron uploads from R2 to YouTube. Decoupled so a quota event doesn't block render velocity.
6. **Single YouTube channel** — `@sohamhamso` (already exists: https://www.youtube.com/@sohamhamso, ~917 subs, 34 existing videos, 227k cumulative views, joined Sep 21 2012). Existing content is **devotional lyric videos** (Sounds of Isha / Sadhguru-adjacent) — tonally different from a scholar-respectful scripture series. Before publishing new series: quarantine existing 34 into a "Devotional Songs" playlist (preserves subs + view-count social proof; do NOT delete). Scripture precedent (Tripura Rahasya CH1) only got 227 views — current audience came for music, not scripture; new content will likely under-perform existing baseline early. All 1,788 videos publish to this one channel with localized titles/descriptions + per-lang hashtags + YouTube's audio-language detection.
7. **Style varies by book / kula** — visual preset (bg color, accent typography, footer attribution line) routes off the text's tradition. Trika kula (Siva Sutras, Pratyabhijna Hrdayam, Spanda Karikas, VBT) and Shakta kula (Karpuradi Stotra) get distinct presets. Driven by `kula` field on each text in `data/youtube-config.yaml`.
8. **Clean-license MVP corpus only**: Siva Sutras (77, Trika) + Spanda Karikas (52, Trika/Spanda) + Pratyabhijna Hrdayam (20, Trika/Pratyabhijna) = **149 verses**. VBT and Karpuradi excluded until Muktabodha permission clears; enforced in config.
9. **Base style** (per kula override available): text-on-color, Indic fonts already at `public/fonts/indic/`, no AI imagery, scholar-respectful voice.
10. **MVP verse**: Siva Sutra 1.1 — `caitanyam ātmā` ("Consciousness is the Self") — 4 English words, foundational, CC-BY 4.0, Trika kula preset.

## Kill Switch + Phase 2 Gate

After Phase 1 ships and 60 videos are live for 30 days, measure:

| Metric | Threshold | If fails |
|--------|-----------|----------|
| CTR-to-canonical-URL | ≥2% | Phase 2 frozen |
| 3s retention | ≥70% | Phase 2 frozen |
| Completion rate | ≥50% | Phase 2 frozen |
| Link-clicks per video (UTM-attributed) | ≥5 | Phase 2 frozen |
| YouTube spam-policy strike | 0 | All uploads pause; channel hygiene review |

If **any** threshold fails: do NOT proceed to Indic. Re-evaluate strategy (pivot options surfaced in CEO review: long-form commentary, podcast, newsletter, Internet Archive primary). If all thresholds clear: unlock Phase 2 Indic implementation (11 langs × 149 verses = 1,639 additional videos).

Mid-pilot abort: if YouTube channel strike or sustained <100 views/video across first 20 uploads, pause Cron B and reassess immediately.

## Critical Files (creation/modification)

```
db/schema.sql                                — append videos + video_analytics (split per E3) + pipeline_runs + youtube_quota + video_events
data/youtube-config.yaml                     — NEW: Zod-validated, includes Muktabodha gate
pipeline/youtube/ARCHITECTURE.md             — NEW (D2): data flow diagram + state machine + secrets inventory + rotation cadence
pipeline/youtube/CLI-CONVENTIONS.md          — NEW (D3): shared --help/--json/--dry-run/--limit=N flag spec, every script conforms
pipeline/youtube/log.ts                      — NEW: structured logs + redaction
pipeline/youtube/config.ts                   — NEW: Zod schema loader
pipeline/youtube/secrets.ts                  — NEW: single chokepoint, hard-fail-in-prod
pipeline/youtube/render-engine.ts            — NEW: TTS + Remotion + QA + R2 orchestration
pipeline/youtube/mocks/                      — NEW (D1 Day-0 requirement): zero-secret path. `MOCK_ALL=true bun scripts/youtube-tts-smoke.ts` produces real MP4 from canned WAV + canned image. TTHW target <10min for fresh contributor.
youtube/composition/Short.tsx                — NEW: Remotion composition (split <500 lines)
youtube/composition/{Devanagari,Transliteration,Translation,Footer,Background}.tsx
src/lib/videos-db.ts                         — NEW: read/write API mirroring src/lib/db.ts
scripts/youtube-validate-config.ts           — NEW: Zod parse + cross-checks
scripts/youtube-backfill-pending.ts          — NEW: one-shot videos-table populator
scripts/youtube-render.ts                    — NEW: per-batch render orchestrator
scripts/youtube-upload.ts                    — NEW: per-batch YouTube uploader
scripts/youtube-status.ts                    — NEW: SQL-only dashboard, supports --help/--json/--dry-run
scripts/youtube-revisit.ts                   — NEW (D4): visibility/title changes without re-render (videos.update, 50 quota units)
scripts/youtube-lease-sweep.ts               — NEW (E4): unstick rows with rendering_lease_at older than 1h
scripts/youtube-supersede-sweep.ts           — NEW (E2): apply auto-private after 30d to superseded YouTube videos
scripts/youtube-oauth-setup.ts               — NEW: single-channel OAuth bootstrap (scope youtube.upload only per E5)
scripts/preflight.sh                         — append: youtube-validate-config + template-version gates
.github/workflows/youtube-generate.yml       — NEW: Cron A (every 6h)
.github/workflows/youtube-upload.yml         — NEW: Cron B (every 4h, single-channel, unlisted-by-default)
.github/workflows/youtube-digest.yml         — NEW: daily ops digest
.github/workflows/youtube-analytics-sync.yml — NEW: per-video view/retention sync (writes video_analytics table)
.github/workflows/youtube-lease-sweep.yml    — NEW (E4): hourly sweep of stale rendering_lease_at rows
.github/workflows/ci.yml                     — append: youtube-rigor job (path-filtered)
tests/unit/youtube/                          — NEW: revised test suite (~10 files, hash-stability + drift-check tests cut per E1):
  - tts-request-builder.test.ts, remotion-props.test.ts, filename-builder.test.ts
  - upload-metadata.test.ts + upload-metadata.snapshot.test.ts
  - cc-by-sa-attribution.test.ts, youtube-eligible-gate.test.ts, translation-status-floor.test.ts
  - template-version.test.ts (hashes composition source, fails CI if template changed without version bump)
  - golden-frame.test.ts (10-verse Indic shaping corpus, kept even in English-only Phase 1 — schema supports Indic)
  - config-schema.test.ts, videos-table.test.ts, pipeline-run-redaction.test.ts (E6 enforcement)
  - supersede-policy.test.ts (E2 — auto-private after 30d or replace-asset)
  - lease-sweep.test.ts (E4 — rendering_lease_at >1h auto-flips to failed)
tests/integration/youtube/                   — NEW: mocked end-to-end (TTS+YouTube+R2 mocks)
scripts/youtube/README.md                    — NEW: operator handbook
package.json                                 — add deps: remotion, @google-cloud/text-to-speech, googleapis, ffmpeg-static; add scripts: youtube:* matching seo:* pattern
.env.example                                 — document GOOGLE_TTS_*, YOUTUBE_OAUTH_*, R2_* vars
```

## Simple Determinism Contract (revised per Eng review)

Replaces the prior `input_hash` keystone — over-engineered for 149-1,788 row scale. Each row stores two fields:

- `translation_md5 TEXT NOT NULL` — md5 of `translations.translation_text` at render time
- `template_version TEXT NOT NULL` — frozen string from `pipeline/youtube/versions.ts::TEMPLATE_VERSION`

Re-render rule: before invoking Remotion, query
```sql
SELECT id, status FROM videos
WHERE text_id=? AND chapter=? AND verse_num=? AND lang=? AND short_index=?
ORDER BY id DESC LIMIT 1
```
If `status IN ('rendered','approved','uploaded')` AND `translation_md5 = <current md5>` AND `template_version = <current version>` → skip. Otherwise mark old row `superseded`, insert new `pending` row.

Translation edit upstream → md5 changes → re-render. Template change → version bumps → cascade re-render. Reproducibility: still a SQL query. Five lines of code instead of canonical_json + 3 test files + 2 operator tools.

Cut from plan (was over-engineered): `pipeline/youtube/hash.ts`, `scripts/youtube-explain.ts`, `scripts/youtube-drift-check.ts`, `youtube-drift-check.yml` cron, `hash-stability.regression.test.ts`, `render_config_hash`, `tts_voice_revision`, canonical_json discussion. Saves ~1.5 weeks of build + ongoing maintenance burden.

## Schema Additions to `db/schema.sql`

```sql
-- Split per Eng review E3: lifecycle table + analytics table separate.

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Identity
  text_id TEXT NOT NULL REFERENCES texts(id),
  chapter INTEGER NOT NULL,
  verse_num INTEGER NOT NULL,
  lang TEXT NOT NULL,
  short_index INTEGER NOT NULL DEFAULT 0,
  channel_handle TEXT NOT NULL DEFAULT '@sohamhamso',
  kula TEXT NOT NULL,
  style_preset TEXT NOT NULL,
  -- Determinism (simplified per E1)
  translation_md5 TEXT NOT NULL,
  template_version TEXT NOT NULL,
  output_file_sha256 TEXT,
  output_bytes INTEGER,
  -- Pinned provenance (for replay 6mo later)
  tts_voice_id TEXT NOT NULL,
  translation_row_id INTEGER NOT NULL REFERENCES translations(id),
  remotion_version TEXT NOT NULL,
  ffmpeg_version TEXT NOT NULL,
  -- Lifecycle
  status TEXT NOT NULL CHECK(status IN (
    'pending','rendering','rendered','approved','rejected',
    'uploading','uploaded','failed','superseded'
  )),
  -- Lease/TTL for crash recovery (E4)
  rendering_lease_at TEXT,             -- set when status flips to 'rendering'; if >1h ago, sweep flips to 'failed'
  uploading_lease_at TEXT,             -- same pattern for upload phase
  -- Storage refs
  r2_key TEXT,
  duration_s REAL,
  youtube_video_id TEXT,
  youtube_url TEXT,
  visibility TEXT DEFAULT 'unlisted' CHECK(visibility IN ('unlisted','public','private')),
  -- Lifecycle audit
  retry_count INTEGER DEFAULT 0,
  upload_retry_count INTEGER DEFAULT 0,
  last_error TEXT,                     -- redacted at write-time per E6 (no service-account paths, R2 keys, OAuth tokens)
  last_error_phase TEXT,
  approved_at TEXT, approved_by TEXT,
  rendered_at TEXT, uploaded_at TEXT,
  priority INTEGER DEFAULT 0,
  -- Supersede policy (E2)
  supersedes_video_id INTEGER REFERENCES videos(id),  -- when re-rendered, points to the row this replaces
  superseded_at TEXT,
  superseded_action TEXT CHECK(superseded_action IN ('auto-private','replace-asset','manual',NULL)),  -- E2 policy
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (text_id, chapter, verse_num, lang, short_index, translation_md5, template_version)
);

-- Per E3: analytics is its own table. Queryable separately from lifecycle state.
CREATE TABLE IF NOT EXISTS video_analytics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  synced_at TEXT NOT NULL,
  view_count INTEGER DEFAULT 0,
  watch_time_s INTEGER DEFAULT 0,
  ctr REAL,
  retention_3s REAL,
  retention_50 REAL,
  completion_rate REAL,
  link_clicks_utm INTEGER DEFAULT 0,
  subscribers_gained INTEGER DEFAULT 0,
  UNIQUE (video_id, synced_at)
);
CREATE INDEX IF NOT EXISTS idx_video_analytics_video ON video_analytics(video_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_input_hash ON videos(input_hash);
CREATE INDEX IF NOT EXISTS idx_videos_verse_lookup ON videos(text_id, chapter, verse_num, lang);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  video_id INTEGER REFERENCES videos(id),
  phase TEXT NOT NULL CHECK(phase IN ('plan','render','probe','upload','status','rotation')),
  status TEXT NOT NULL CHECK(status IN ('ok','err','skip','dryrun')),
  duration_ms INTEGER NOT NULL,
  tts_bytes_synthesized INTEGER DEFAULT 0,
  r2_bytes_written INTEGER DEFAULT 0,
  youtube_api_units INTEGER DEFAULT 0,
  error_code TEXT, error_msg TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_quota (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_handle TEXT NOT NULL,
  utc_date TEXT NOT NULL,
  units_spent INTEGER NOT NULL DEFAULT 0,
  uploads_count INTEGER NOT NULL DEFAULT 0,
  exhausted INTEGER NOT NULL DEFAULT 0,
  UNIQUE (channel_handle, utc_date)
);

CREATE TABLE IF NOT EXISTS video_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  event TEXT NOT NULL,
  meta TEXT,
  occurred_at TEXT DEFAULT (datetime('now'))
);
```

Apply via existing `bash scripts/turso-apply-schema.sh` — no new migration tool.

## Two-Cron Architecture

### Cron A — generation (`.github/workflows/youtube-generate.yml`)

```yaml
on:
  schedule: ['0 */6 * * *']      # every 6h, matches GHA 6h job ceiling
  workflow_dispatch:
    inputs: { text_slug, lang, force, dry_run }
```

Per fire:
1. `bun scripts/youtube-render.ts --limit=50`
2. Picker selects rows where `status='pending'` OR (`status='failed'` AND `retry_count<3`)
3. For each: compute current `input_hash` → skip if match — else: TTS → Remotion → QA → R2 upload → DB update
4. QA gates: file >100KB, duration ∈ [15s,60s], audio loudness > -40 LUFS, h264+aac codecs, R2 ETag matches local md5
5. On step failure → open Issue labeled `youtube-gen-failure` (precedent: `turso-backup.yml`)

### Cron B — deployment (`.github/workflows/youtube-upload.yml`)

```yaml
on:
  schedule: ['30 */4 * * *']     # 30min offset from Cron A
  workflow_dispatch:
```

Per fire (single job, no matrix — single channel):
1. Check `youtube_quota` for today; skip if spent > 8000 units (2k headroom)
2. Pull oldest `approved AND youtube_video_id IS NULL` row
3. R2 → `/tmp/upload.mp4` → `videos.insert` (1600 units) with localized title/description per the row's `lang`
4. Post-upload integrity check: sha256 of remote object vs `output_file_sha256`
5. On 403 quotaExceeded → set `exhausted=1`, exit 0
6. On success → update `videos`, `youtube_quota`, log to `pipeline_runs`

**Single channel under one Google Cloud Project → 10k units/day default = 6 uploads/day.** **Quota raise is the only path** (see Critical Path below).

**Localized metadata per video** — even on a single channel, each video sets:
- `snippet.defaultLanguage` = the lang code (e.g. `ta`, `hi-IN`)
- `snippet.defaultAudioLanguage` = same
- `snippet.title` = `{text_title_lang} {chapter}.{verse_num} — {short_label_lang}`
- `snippet.description` = lang-rendered description with native-script attribution
- `snippet.tags` = base + per-lang tags from config
- `localizations.<lang>.title/description` populated for cross-lang discovery

### Cron C — DROPPED per Eng E8

Original plan: GitHub-issue-based review queue with `/approve`/`/reject` comments. Dropped because YouTube Studio is the actual review surface (player + analytics preview + native moderation). The GitHub-issue approval ceremony is novelty engineering for a single operator.

**Replacement flow**: Cron A flips `status='rendered' → 'approved'` automatically after passing automated QA gates (file >100KB, duration ∈ [15s,60s], audio loudness > -40 LUFS, codecs valid, ETag match). Cron B uploads as `visibility='unlisted'`. Operator reviews each video in YouTube Studio (real UI, real preview), uses `scripts/youtube-revisit.ts --video-id=N --visibility=public` to flip live when satisfied. The compliance-audit narrative becomes "human reviewed in YouTube Studio before publishing" — equally valid for the audit reviewer.

### Cron D — digest (`youtube-digest.yml`, daily noon UTC)

GitHub issue + Slack webhook: rendered/approved/uploaded/failed last 24h, quota %, cost run-rate.

### Cron E — analytics sync (`youtube-analytics-sync.yml`, daily 5am UTC)

YouTube Analytics API → updates `videos.view_count/watch_time_s/retention_50`. 2 units/query, separate from upload quota.

## Style Variants by Book / Kula

Texts route to a `kula` (lineage), which routes to a `style_preset` (visual config). Resolved at config-load time; preset stamped into `videos.style_preset` and contributes to `input_hash` (so a preset change cascades re-renders).

### Kula → preset mapping

| Text | Kula | Preset |
|------|------|--------|
| Siva Sutras | trika | `trika-classic` |
| Pratyabhijna Hrdayam | trika-pratyabhijna | `trika-recognition` |
| Spanda Karikas | trika-spanda | `trika-pulse` |
| Vijnana Bhairava Tantra | trika | `trika-classic` (when license clears) |
| Karpuradi Stotra | shakta | `shakta-kali` (when verified clean) |

### Preset shape (in `data/youtube-config.yaml`)

Palettes researched from scholarly publications (SUNY Shaiva Traditions, Motilal, hareesh.org, Dyczkowski, Kinsley UC Press) — distinct from "wellness slop" / Sadhguru / saffron-political register.

```yaml
style_presets:
  trika-classic:
    bg: "#0E1B2E"               # midnight-indigo (Kashmiri winter sky)
    accent: "#C9A961"           # aged-gold (manuscript leaf)
    text: "#E8E4D8"             # manuscript-cream
    headline_font: "EB Garamond"
    body_font: "EB Garamond"
    devanagari_font: "Noto Serif Devanagari"  # already in repo; avoids Jan 2026 Noto Sans Devanagari shaping bug
    footer_line: "Trika Śaiva canon · sohamhamso.org"
    ornament: none

  trika-recognition:
    bg: "#13192B"               # slightly cooler indigo, distinguishes from base Trika
    accent: "#C9A961"
    text: "#E8E4D8"
    headline_font: "EB Garamond"
    body_font: "EB Garamond"
    devanagari_font: "Noto Serif Devanagari"
    footer_line: "Pratyabhijñā lineage · sohamhamso.org"
    ornament: none

  trika-pulse:
    bg: "#0E2024"               # deep slate, hint of teal for Spanda's "pulse"
    accent: "#C9A961"
    text: "#E8E4D8"
    headline_font: "EB Garamond"
    body_font: "EB Garamond"
    devanagari_font: "Noto Serif Devanagari"
    footer_line: "Spanda lineage · sohamhamso.org"
    ornament: none

  shakta-kali:
    bg: "#0A0507"               # cremation near-black (Kinsley UC Press tradition)
    accent: "#8B1A1A"           # oxblood crimson
    accent_gold: "#D4AF37"      # temple-gold, used sparingly
    text: "#F2EDE4"             # bone-white
    headline_font: "EB Garamond"
    body_font: "EB Garamond"
    devanagari_font: "Noto Serif Devanagari"
    footer_line: "Śākta canon · sohamhamso.org"
    ornament: none

texts:
  siva-sutras:          { kula: trika,                style_preset: trika-classic,    youtube_eligible: true,  min_translation_status: reviewed }
  pratyabhijna-hrdayam: { kula: trika-pratyabhijna,   style_preset: trika-recognition, youtube_eligible: true,  min_translation_status: reviewed }
  spanda-karikas:       { kula: trika-spanda,         style_preset: trika-pulse,      youtube_eligible: true,  min_translation_status: reviewed }
  vijnana-bhairava-tantra:
                        { kula: trika,                style_preset: trika-classic,    youtube_eligible: false, reason: "Muktabodha — permission pending" }
  karpuradi-stotra:     { kula: shakta,               style_preset: shakta-kali,      youtube_eligible: false, reason: "license verification pending" }
```

### Visual anti-patterns explicitly forbidden

These get rejected at the `youtube-validate-config` gate (CSS-color-keyword and hex range checks):

- **Saffron-orange** (`#FF9933` and ±15% range) — politically coded as BJP/Hindu nationalist flag color
- **Magenta / hot-pink** — "sacred feminine" neo-tantra signal
- **Purple-gold gradients** — Sadhguru / New Age mystical
- **Pure-black + pure-white** — brutalist tech register
- **Turquoise "om water bottle"** — appropriation flag
- **Rainbow chakra spectrum** — neo-tantra projection

Forbidden iconography (config-level constants):
- **No Om symbol as decorative motif** — canonical appropriation example
- **No stylized Kali (cute tongue / severed-heads-as-graphic)** — disrespectful
- **No deity images at all in MVP** — defer to V2 with cultural-sensitivity review

### Typography rationale

- **EB Garamond** (Latin/IAST): full pre-composed diacritics (ṛ ḷ ṃ ḥ ś ṣ ṭ ḍ ṇ), OFL, scholarly book register. Beats Gentium Plus on aesthetic; Gentium remains technical alternative if needed.
- **Noto Serif Devanagari** (already in `public/fonts/indic/`): variable-weight woff2, HarfBuzz-correct shaping. Avoids the Jan 2026 Noto Sans Devanagari `ट्विस्ट` shaping bug (notofonts/devanagari#70). Serif register matches scholarly publication style.
- **Forbidden**: Mangal (Microsoft default — ugly conjuncts), Kruti Dev (non-Unicode legacy), sans-serif paired with Devanagari (corporate register), cursive/script fonts (wellness signal), Times New Roman (cheap-reprint feel).

### Remotion composition + Indic font rendering

`youtube/composition/Short.tsx` receives `style_preset` as a prop. The orchestrator (~150 lines) selects which sub-composition renders the background, ornament, and footer based on the preset name. Sub-compositions (`Background.tsx`, `Footer.tsx`) read `bg`, `accent`, `footer_line` from props — no hardcoded branding.

**Indic shaping risk** (verified PARTIAL — needs setup): Remotion uses Chromium + HarfBuzz, which shapes Indic scripts correctly. But Linux GHA runners and Docker containers lack Indic fonts by default → renders as tofu boxes. Mitigations:

1. **Use repo's existing Noto Serif Indic variable woff2 files** at `public/fonts/indic/` (9 files: Devanagari, Tamil, Telugu, Kannada, Oriya, Gurmukhi, Bengali, Gujarati, Malayalam). Load in Remotion via `@remotion/fonts`:
   ```tsx
   import { loadFont } from '@remotion/fonts';
   loadFont({ family: 'Noto Serif Devanagari', url: staticFile('fonts/indic/NotoSerifDevanagari.woff2') });
   ```

2. **GHA workflow font install** (safety net for system font fallback):
   ```yaml
   - run: sudo apt-get install -y fonts-noto-core fonts-noto-extra && fc-cache -fv
   ```

3. **Chromium flag** in Remotion config: `--font-render-hinting=none` for stable LCD rendering across runners.

4. **DO NOT use Satori or resvg-wasm for Indic text** — neither shapes Indic scripts (they render glyphs as bare codepoints with no conjunct/ligature/matra positioning). The existing `@resvg/resvg-wasm` is fine for the OG endpoint's Latin-mostly use but cannot be repurposed for Indic-heavy video frames.

**Assamese gap**: no separate Noto Assamese file in repo. Assamese uses Bengali script + 2 extra chars (U+09F0 ROW, U+09F1 WAW). Verify the Bengali file covers them; if not, add `NotoSerifBengali-Assamese.woff2` or hardcode the glyphs as SVG paths.

**Vedic accents** (U+1CD0–U+1CFF): verify Noto Serif Devanagari coverage. If gap, add Siddhanta as supplemental font.

**Golden-corpus test verses** (10 verses spanning shaping edge cases — required pre-production):
1. Devanagari conjunct stack: BG 2.47 — `कर्मण्येवाधिकारस्ते` (compound consonants)
2. Devanagari with anusvara + visarga: Siva Sutra 1.1 — `चैतन्यमात्मा`
3. Vedic accents (udatta/anudatta/svarita): Rigveda 1.1.1
4. Tamil grantha letters: रुद्र in Tamil script
5. Malayalam chillu: വൻ (ZWJ survival critical)
6. Telugu vattu (subjoined consonant): కృష్ణ
7. Kannada ottakshara: ಕ್ಷ
8. Gurmukhi subjoined: ਪ੍ਰ
9. Bengali ya-phala: ক্য
10. IAST diacritic stack: `Pratyabhijñāhṛdaya` (ñ, ā, ṛ, ḥ all in one word)

Render all 10 in a `golden-frame.test.ts` baseline; hash diffs fail the build.

**Fallback path if Chromium+Indic fails**: use `text-to-svg-hb` (HarfBuzz-backed) at ingest time to convert text to SVG paths, embed as static images in Remotion. Shaping guaranteed correct; loses runtime font flexibility; adds ~1 week of work. Defer unless MVP render shows shaping failures.

### Drift safety

A preset change (rename, bg color tweak, footer wording) MUST bump `template_version` in `pipeline/youtube/versions.ts::TEMPLATE_VERSION`. The `template-version.test.ts` hashes the composition source files and fails CI if the source changed without a version bump. This is the only way a preset change can be merged.

## R2 Storage Layout

```
sohamhamso-backups/                        # existing bucket
  videos/<text>/<chapter>/<verse>/<lang>/
    <input_hash>.mp4                       # hash-addressed, immutable
    <input_hash>.thumb.jpg
    <input_hash>.meta.json
  manifests/
    videos-index.json                      # regenerated post-Cron-A
    by-lang/<lang>.json
```

Hash-addressed = concurrency-safe + auto-superseded on translation edit. Old objects kept 90d for audit; quarterly GC sweep.

## Critical Path: YouTube API Compliance Audit (file BEFORE bulk upload, not necessarily Day 1)

**Premise correction**: On Dec 4, 2025, Google reduced `videos.insert` cost from 1,600 units to ~100 units (separate bucket). **Default 10k units/day now = ~100 uploads/day.** 1,788 videos ÷ 100 = **~18 days at default quota**. The original "quota raise as critical path" premise is busted.

What's still critical:
- **Compliance audit** is mandatory for public uploads on post-2020-07-28 apps. Without it, uploads stay private/unlisted. This is a hard gate.
- **Spam policy risk**: July 2025 YouTube policy targets "AI to churn out high volumes of similar content". 1,788 short, templated, AI-translation-assisted videos will trip the mass-production detector unless human-curation signals are loud and unambiguous.

Pre-filing checklist (must be true before filing):
- Channel phone-verified (required for >15 min uploads — and good optics)
- Google for Nonprofits enrollment via EIN (if applicable; adds legitimacy, no automatic quota boost)
- Public privacy policy + ToS on sohamhamso.org (verify URLs)
- OAuth consent screen verified
- **50-100 sample uploads live before applying** — proof of pattern (not promise)
- Written use case with concrete math (verse count, languages, lang-targeting, attribution chain)
- Channel-level AI-translation disclosure in About + every description
- Per-video CC-BY-SA + Muktabodha attribution chain
- Human-in-loop approval log ready to demonstrate (the daily review issue + GitHub PR record)

Screencast (3-5 min, end-to-end one example): manuscript → review → approval → upload → live page with attribution. **Emphasize human approval gates and rejection examples — strongest counter-signal to content-farm classification.** Show the daily-issue approval workflow prominently.

Application timeline: clean first-pass typically 1-2 weeks; messy submissions weeks to months (5-month outliers documented). Plan's 4-6 week buffer is fine.

Quota extension (200k/day = 1,788 in 15 days) is **optional, not required**. Default 10k/day = 18-day backfill is acceptable.

**Backup if compliance audit takes longer than expected**: Mirror to Internet Archive in parallel (no quota, ideal for cultural-heritage archival). Vimeo + Bilibili as secondary distribution. Don't gate on YouTube.

## Build Sequence (10 weeks to 149 English videos live + Phase 2 gate decision)

Per Eng E9: 6-week original was unrealistic; 10-week reflects compliance-audit serialization + Indic-font recovery contingency + sample-upload buffer.

### Week 1 — channel hygiene + Day 0 mock + MVP single video

**Parallel work item (non-blocking)**: pre-filing checklist work — Google for Nonprofits enrollment (if EIN), privacy policy + ToS verified on sohamhamso.org, channel phone verification, OAuth consent screen verified. **Do NOT file the compliance audit yet** — needs 50-100 sample uploads live first.

**Sequential build**:
1. Day 1 (channel hygiene): Quarantine existing 34 devotional videos into new "Devotional Songs" playlist on @sohamhamso (manual, ~30 min). Rewrite About to reflect dual mission (existing songs + new scripture series). Add channel-level AI-translation disclosure. Add new "Scripture Readings" playlist (empty placeholder).
2. Day 1 (D1 mock layer): Build `pipeline/youtube/mocks/` first. `MOCK_ALL=true bun scripts/youtube-tts-smoke.ts` must produce a real MP4 from canned WAV + canned image with zero secrets. Lock TTHW <10 min for contributor.
3. Day 1 (TTS smoke, real): `scripts/youtube-tts-smoke.ts` — Generate Siva Sutra 1.1 English narration in 3 Google voices (`en-US-Studio-O`, `en-US-Studio-Q`, `en-US-Neural2-C`). Cost: ~$0.01. Pick voice by ear before touching Remotion. **If no voice clears the listen test, pivot to ElevenLabs (English) hybrid before proceeding.**
4. Day 2-3: Bootstrap Remotion at `youtube/composition/` with `@remotion/fonts` loading Noto Serif Devanagari from `public/fonts/indic/`. Single composition `Short.tsx` (split into 5 files <150 lines each). Render Siva Sutra 1.1 English to local MP4: 18s, pure silence under narration, midnight-indigo bg `#0E1B2E`, aged-gold accent `#C9A961`, Devanagari+IAST+EN stack in EB Garamond + Noto Serif Devanagari. Verify Chromium renders Indic conjuncts correctly with `--font-render-hinting=none`.
5. Day 4: Manual upload to @sohamhamso (unlisted, in "Scripture Readings" playlist). Validate end-to-end loop. Measure cycle time + cost.
6. Day 5-7: Lock English voice in `data/youtube-config.yaml`. Lock kula style presets (Trika preset enough for Phase 1). Defer Azure secrets and Indic voice locks to Phase 2. Run golden-corpus test on Devanagari + IAST renderings only (Indic-script tests run when Phase 2 unlocks).

### Week 2 — data layer + automated render

5. Append schema to `db/schema.sql` (videos + pipeline_runs + youtube_quota + video_events). Apply via `scripts/turso-apply-schema.sh`.
6. `src/lib/videos-db.ts` — read API mirroring `src/lib/db.ts:166` getDb pattern; writer mirroring `subscriber-db.ts`.
7. `pipeline/youtube/hash.ts` + `pipeline/youtube/config.ts` + `pipeline/youtube/secrets.ts` + `pipeline/youtube/log.ts`. Unit tests for each.
8. `scripts/youtube-validate-config.ts`. Hash stability regression test with locked goldens.
9. `scripts/youtube-backfill-pending.ts` — populate videos table with all 1,788 pending rows. Idempotent INSERT OR IGNORE.
10. `pipeline/youtube/render-engine.ts` + `scripts/youtube-render.ts`. TTS → Remotion → QA → R2 → DB.
11. `.github/workflows/youtube-generate.yml`. Manual-trigger first: `text_slug=siva-sutras lang=en` → 1 video in R2.

### Week 3 — upload layer

12. `scripts/youtube-oauth-setup.ts` — single OAuth flow for @sohamhamso, `gh secret set YT_REFRESH_TOKEN`. ~15 minutes.
13. `scripts/youtube-upload.ts` + `.github/workflows/youtube-upload.yml` (single job). Initial run: 12-language render of Siva Sutra 1.1 → 12 live unlisted videos on @sohamhamso, each with localized title/description per lang.

### Week 4 — quality gates + review queue

14. `scripts/youtube-explain.ts`, `scripts/youtube-drift-check.ts`, `scripts/youtube-status.ts`.
15. `.github/workflows/youtube-review-queue.yml` + `/approve` `/reject` issue-comment handler.
16. Wire automated QA gates into `youtube-render.ts`.

### Week 5 — observability

17. `.github/workflows/youtube-digest.yml` (Cron D).
18. `.github/workflows/youtube-analytics-sync.yml` (Cron E).
19. Cost dashboard at `sohamhamso.org/ops/youtube-stats` (Astro static route, gated).

### Week 6 — full test suite + CI gating

20. `tests/unit/youtube/` (15 files): hash, tts-request-builder, remotion-props, filename-builder, upload-metadata, upload-metadata.snapshot, cc-by-sa-attribution, youtube-eligible-gate, translation-status-floor, template-version, golden-frame, config-schema, hash-stability.regression, videos-table, pipeline-run-redaction.
21. `tests/integration/youtube/`: render-full-flow + upload-flow w/ mocked TTS+YouTube+R2.
22. Chaos tests: tts-timeout, youtube-quota, r2-partial.
23. Append `youtube-rigor` job to `.github/workflows/ci.yml` (path-filtered).
24. Append YouTube gates to `scripts/preflight.sh`.

### Week 6-7 — Phase 1 sample uploads (60 → 149)

25. Generate 60 sample videos via Cron A (Siva Sutras 1.1-1.22 + Spanda Karikas Ch 1 + Pratyabhijna Hrdayam intro sutras). Stockpile in R2 + DB.
26. Cron A auto-approves on QA pass. Cron B uploads as `unlisted` at default quota = ~100/day → all 60 live unlisted within 1 day.
27. Operator reviews each in YouTube Studio. Uses `scripts/youtube-revisit.ts --video-id=N --visibility=public` to flip live progressively over 1-2 weeks.
28. Continue backfilling remaining 89 verses through Cron A → upload to unlisted → manual public flip.

### Week 8 — compliance audit filing

29. **NOW file the YouTube API compliance audit** — with 60-100 live samples, attribution chain visible, manual review evidence via YouTube Studio audit log. Reviewers see pattern, not promise. Quota extension optional (default 10k/day = 100 uploads/day is more than sufficient for 149-video scope).

### Week 9-10 — Phase 1 measurement window + Phase 2 gate

30. By week 10, all 149 English videos live (mix of unlisted and public per operator review pace). 30 days of analytics data on the first batch via Cron E analytics-sync.
31. **Phase 2 Gate** (see Kill Switch section): measure CTR-to-canonical, retention, completion, link-clicks-per-video against thresholds. Open quantitative review meeting.
32. **If gate passes**: unlock Phase 2 (Indic implementation). New 5-7 week build adds Azure TTS, Chirp3-HD Telugu, font goldens for 10 Indic scripts, Indic translation backfill rows.
33. **If gate fails**: freeze pipeline. Re-evaluate per CEO review's pivot options (long-form commentary, podcast, newsletter, Internet Archive primary). The existing 149 English videos stay live as a scripture archive on @sohamhamso.

## Existing Code to Reuse

| Need | Existing | Location |
|------|----------|----------|
| Corpus query in 12 langs | `getVerseAllLanguages()` | `src/lib/db.ts` |
| DB read pattern | `getDb()` | `src/lib/db.ts:166` |
| DB writer pattern | `subscriber-db.ts` | `src/lib/subscriber-db.ts` |
| Indic fonts (10 scripts) | WOFF2 files | `public/fonts/indic/` |
| Cron + R2 backup precedent | `turso-backup.yml` | `.github/workflows/turso-backup.yml` |
| Issue-on-failure template | turso-backup.yml lines 76-94 | same |
| Single-purpose verifier style | `seo-validate.ts`, `seo-cache-freshness.ts` | `scripts/seo-*.ts` |
| SVG→PNG (if needed alongside Remotion) | `@resvg/resvg-wasm` | already in deps |
| Schema additive pattern | `db/schema.sql` + `turso-apply-schema.sh` | no migration tool |
| Zod config validation | `corpus-schema.ts` | `src/lib/seo/` |
| Preflight gate composition | `preflight.sh` | `scripts/preflight.sh` |
| .env.example documentation style | SUBSCRIBER_HASH_PEPPER block | `.env.example` |

## Anti-Patterns Forbidden

- No re-rendering when `input_hash` matches — `--force` flag does not exist; manually flip row to `superseded` for audit trail.
- No mutating updates to `videos` rows after `status='uploaded'` — append-only history.
- No raw `console.error(e)` in pipeline scripts — always via `pipeline/youtube/log.ts::logError` which scrubs translation text.
- No `process.env.GOOGLE_TTS_*` reads outside `pipeline/youtube/secrets.ts`.
- No new migration tool — append to `db/schema.sql`, idempotent.
- No template change without `template_version` bump.
- No `default_visibility: public` in config (default `unlisted`, explicit override required).
- No draft translations entering the pipeline (`min_translation_status: reviewed`).
- No multi-project quota workaround (ToS violation).

## Cost Projections (Phase 1: 149 English videos)

| Item | Phase 1 (149) | Phase 2 (1,788 if unlocked) | 10k future scope | Notes |
|------|---------------|------------------------------|------------------|-------|
| GCP TTS WaveNet | $0.27 | $2.40 | $13.40 | $4/1M chars; 450 chars/verse upper bound |
| GCP TTS Chirp3-HD (te only) | $0 | $1.34 | $7.50 | only activated in Phase 2 |
| Azure TTS (or, as) | $0 | $0.96 | $5.40 | only activated in Phase 2 |
| GHA minutes (public repo) | $0 | $0 | $0 | repo is public |
| R2 storage | $0.03/mo | $0.40/mo | $2.25/mo | 15 MB/video; egress free |
| YouTube API | $0 | $0 | $0 | default quota sufficient (post-Dec-2025 pricing) |
| **Phase 1 cash** | **~$0.30/yr** | | | English-only validation cost |

Phase 1 is essentially free. Phase 2 unlock decision gates ~$5/yr additional spend on 11 more languages — trivial; the real cost of Phase 2 is the ~5-6 weeks of build effort, which is gated on kill-switch thresholds.

## Failure Modes + Recovery

- **TTS outage mid-batch**: per-row failures; next 6h fire re-picks. `retry_count<3` auto-retry. Hybrid (Google + Azure) means one vendor going down doesn't block all langs.
- **YouTube quota exhausted**: expected; per-fire pre-check prevents 403. Reset at midnight Pacific. Default 10k/day = 100 uploads/day (post-Dec-2025 reduction).
- **YouTube spam-policy strike (1,788 templated AI-translation videos)**: HIGH RISK per July 2025 policy. Mitigations: (a) human-in-loop review gate visible in workflow, (b) per-video attribution + license + UTM-tagged backlink, (c) 50-100 sample uploads + compliance audit before going public, (d) stagger upload cadence (don't bulk-upload 100/day every day; mix into Cron B's 4h cadence = ~6/cycle), (e) channel-level AI disclosure in About + every description.
- **Translation edit upstream**: auto-detected by hash; old row → `superseded`, new row → `pending`. Old YouTube video NOT auto-deleted (manual gate).
- **Channel strike**: single-channel blast radius is large — mitigate via conservative defaults (comments off, unlisted-first, per-video manual approval gate, no clickbait titles). On strike: pause Cron B via `gh workflow disable`, appeal in YT Studio, resume on clearance. Existing 34 devotional videos protected by playlist quarantine.
- **Workflow crash**: GitHub Issue per `turso-backup.yml` precedent.
- **DB corruption**: `turso-backup.yml` covers; R2 manifest is canonical fallback.
- **Remotion template breaking change**: bump `template_version` → controlled cascade re-render with A/B validation on 1 verse per lang first.
- **Indic font tofu on GHA runners**: detected by `golden-frame.test.ts` (hash diff fails CI). Recovery: re-pin Noto Serif Indic files in `public/fonts/indic/`, re-run `fc-cache -fv` in workflow, confirm `--font-render-hinting=none` flag.
- **Chirp3-HD Telugu SSML failure**: no SSML support → Sanskrit proper nouns mispronounced. Mitigation: pre-recorded splices for known Sanskrit terms (Śiva, Tantra, Vasugupta, Abhinavagupta, etc.) injected into Telugu audio via FFmpeg post-process. Tracked in `pipeline/youtube/voice-overrides.yaml`.

## Verification

End-to-end:

```bash
cd /Users/danny/Documents/GitHub/sohamhamso

# 0. validate config
bun run youtube:validate-config

# 1. apply schema
bash scripts/turso-apply-schema.sh

# 2. backfill pending rows (idempotent)
bun scripts/youtube-backfill-pending.ts
# expect: 1,788 rows in videos table, all status='pending'

# 3. trigger single-verse render
gh workflow run youtube-generate.yml \
  -f text_slug=siva-sutras -f lang=en -f dry_run=false
# expect: 1 row flips pending → rendering → rendered, R2 object at videos/siva-sutras/1/1/en/<hash>.mp4

# 4. dashboard
bun scripts/youtube-status.ts
# expect: rendered=1 pending=1787

# 5. explain tool sanity
bun scripts/youtube-explain.ts siva-sutras 1 1 en
# expect: prints input_hash + matched row

# 6. drift detection (after a translation edit)
bun scripts/youtube-drift-check.ts
# expect: 1 superseded row + 1 new pending row

# 7. unit + integration + chaos tests
bun run youtube:test
bun run youtube:integration

# 8. CI green on path-filtered job
gh workflow run ci.yml
# expect: youtube-rigor job passes

# 9. preflight green
bash scripts/preflight.sh
# expect: youtube gates 5-6/6 pass

# 10. manual approval flow
# - Cron C opens an issue with rendered videos
# - reviewer comments /approve → DB status flips approved
# - Cron B picks it up on next 4h fire, uploads to YouTube

# 11. analytics back-pressure (after upload)
gh workflow run youtube-analytics-sync.yml
# expect: videos.view_count updates from YouTube Analytics API
```

Live success criteria (7 days post first batch):

- CTR-to-canonical-URL > 2% (primary)
- 3s retention > 70%
- Completion rate > 50%
- Zero `pipeline-run-redaction` test failures
- Quota raise approved at 200k/day OR demonstrable progress in audit thread

## Research-Verified Facts (Phase 1 inputs locked)

These were verified by parallel research agents before plan approval, replacing earlier assumptions:

| Item | Original assumption | Verified fact |
|------|---------------------|---------------|
| TTS pricing | $16/1M chars | **$4/1M for WaveNet, $16 for Neural2, $30 for Chirp3-HD** |
| TTS coverage | "Google covers all 12 langs" | **Google covers 10; Telugu has no WaveNet (Chirp3-HD only, no SSML); Odia + Assamese need Azure** |
| YouTube quota cost | 1,600 units/upload | **~100 units/upload (Google reduced Dec 4, 2025)** |
| Default daily uploads | 6/day | **~100/day** |
| Backfill timeline at default | 298 days | **~18 days** |
| Quota raise urgency | "Critical path Day 1" | **Optional; file compliance audit instead, after 50-100 sample uploads** |
| Channel existence | "Use @sohamhamso" | **Confirmed exists, 917 subs, 34 devotional songs, 227k views** |
| Existing channel content alignment | "Empty / unknown" | **Devotional songs (Sounds-of-Isha-adjacent); scripture series will be tonally distinct; quarantine to playlist** |
| Audience baseline expectation | "1,788 videos at launch will get views" | **Scripture precedent (Tripura Rahasya CH1) only got 227 views vs music's 22k peak; expect under-performance early** |
| Visual conventions | "Designer choice" | **Scholar palette: midnight-indigo + aged-gold + manuscript-cream (Trika), near-black + oxblood + bone-white (Shakta). Avoid saffron, magenta, purple-gold, Om motif** |
| Typography | "Cinzel + Gentium Plus + Sanskrit 2003" | **EB Garamond + Noto Serif Devanagari (already in repo); avoid Mangal/Kruti Dev/Times** |
| Remotion + Indic shaping | "Works" | **PARTIAL — HarfBuzz correct, but Linux containers need explicit font install + `--font-render-hinting=none`; DO NOT use Satori/resvg for Indic** |
| AI/automation spam-policy risk | Not flagged | **HIGH — July 2025 YouTube policy targets bulk AI content; human-in-loop demonstration mandatory** |

## Security Hardening (per Eng E5-E7)

**E5 — OAuth blast radius**
- Scope: `https://www.googleapis.com/auth/youtube.upload` only (NOT full `youtube` scope which grants channel/comment/playlist mutation)
- Quarterly rotation playbook in `scripts/youtube/README.md::OAuth Rotation`:
  1. Run `bun scripts/youtube-oauth-setup.ts --refresh` (issues new refresh token)
  2. `gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt`
  3. Revoke old token via console.cloud.google.com/apis/credentials
  4. Log to `pipeline_runs` with `phase='rotation'`
- Anomaly detection in Cron D digest: alarm if `uploads_per_hour > 20` (catches compromised key within 4h vs daily-quota detection which catches at 24h)
- Second human admin on @sohamhamso Brand Account (bus-factor); documented in `scripts/youtube/README.md::Channel Handover`

**E6 — last_error redaction at write-time**
- `pipeline/youtube/log.ts::scrubError(e)` regex-strips before INSERT:
  - Service account paths matching `/[A-Za-z0-9_-]+\.iam\.gserviceaccount\.com/`
  - R2 access keys matching `/AKIA[A-Z0-9]{16}/`
  - OAuth tokens matching `/(ya29|1\/\/)[A-Za-z0-9_-]{30,}/`
  - 30+-char Devanagari/Tamil/etc. substrings (translation text leak prevention)
- Test enforced by `pipeline-run-redaction.test.ts` — feed canned exceptions, assert sensitive strings absent from persisted error_msg

**E7 — R2 signed URL TTL + access**
- Signed URL TTL: 24h (was unspecified)
- GitHub issues for any operator review surface: marked private. Repo stays public for GHA free tier; only the review issues are private (requires Pro org)
- Daily digest Issues: created with `--private` flag via gh CLI; restricted to maintainer team
- No raw R2 signed URLs in public-facing channels (no Discord, no public Slack, no email)

## Open Items (Out of Scope for This Plan)

- **Indic Phase 2 implementation** — gated on Phase 1 kill-switch thresholds
- Which 12 "shorts" a verse decomposes into (`short_index=0` only for Phase 1; multi-short artistic decision deferred)
- Subtitle/caption generation
- YouTube auto-dub migration evaluation — re-evaluate at Phase 2 gate (CEO flagged 70% chance auto-dub makes 12-per-verse model obsolete; Phase 2 decision must reconsider single-video + multi-audio approach as serious alternative)
- Channel handover playbook for post-EIN non-profit transfer
- VBT (112 dharanas) + Karpuradi inclusion gated on Muktabodha permission
- Per-language voice quality A/B testing
- **Long-form (10-30 min commentary) feeder content** — CEO recommendation; could be Phase 1.5 if shorts CTR underperforms but engagement signals exist
- **Internet Archive cross-posting** — CEO recommendation as primary distribution channel; defer to Phase 2 decision
- **Podcast / Spotify distribution** — same as above
- **Newsletter "verse of the week"** — owned distribution; defer
- Per-kula ornament/yantra rendering (deliberately blank — adding glyphs needs cultural-sensitivity review)
- Mobile review workflow QA (test R2 signed URL playback in GitHub mobile app)
- Architecture doc auto-gen from schema + workflow YAMLs

## Autoplan Review Report

**Reviewers**: 3 independent Plan agents (CEO/strategy, Eng/architecture, DX/operator). No Codex voice (not in git context). No Design phase (no website UI scope).

**Verdicts**: CEO = SUBSTANTIAL REVISION; Eng = APPROVE WITH CHANGES; DX = APPROVE WITH CHANGES.

**User Challenges (CEO pushed back on locked decisions)**:
- ❌ REJECTED: 12-vids-per-verse strategy (user keeps pipeline design supporting it; auto-dub re-evaluation deferred to Phase 2 gate)
- ✅ ACCEPTED: full 1,788 scope before validation → revised to English-only 149 pilot + kill switch at 60 videos
- ❌ REJECTED: fresh channel vs @sohamhamso (user keeps existing channel; quarantine existing 34 to playlist; accepts algorithmic-identity risk)

**Eng Tightenings (all applied)**:
- E1: Replaced `input_hash` keystone with `translation_md5 + template_version` tuple — cut ~30% scope
- E2: Supersede policy: auto-private after 30d OR `videos.update` asset replacement
- E3: Split `videos` table → `videos` + `video_analytics`
- E4: Row-level lease (`rendering_lease_at`, `uploading_lease_at`) + `youtube-lease-sweep` cron
- E5: OAuth scope `youtube.upload` only; quarterly rotation playbook + anomaly detection
- E6: `last_error` redaction at write-time via `scrubError()` + `pipeline-run-redaction.test.ts`
- E7: R2 signed URL TTL = 24h; private GitHub issues
- E8: Dropped Cron C review queue; YouTube Studio is the review surface
- E9: Timeline 6w → 10w

**DX Tightenings (all applied)**:
- D1: Day 0 mock mode requirement (TTHW <10 min via `MOCK_ALL=true`)
- D2: `pipeline/youtube/ARCHITECTURE.md` (data flow + state machine + secrets inventory)
- D3: `pipeline/youtube/CLI-CONVENTIONS.md` (shared --help/--json/--dry-run/--limit=N)
- D4: `scripts/youtube-revisit.ts` for visibility/title changes without re-render
- D5: 5 error templates (RENDER_FAILED, YT_OAUTH_EXPIRED, HASH_DRIFT_DETECTED, QUOTA_PRECHECK_BLOCKED, CONFIG_LICENSE_GATE)

**Cross-Reviewer Theme**: "Plan over-builds the rigorous skeleton before validating the product hypothesis." Resolved by Phase 1/Phase 2 split: the rigorous skeleton (Eng + DX tightenings) builds for 10 weeks against a 149-video validation experiment, then earns the right to scale to 1,788.
