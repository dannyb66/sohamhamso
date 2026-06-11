# YouTube Pipeline — Architecture (D2)

The pipeline ships **two formats** from the same `videos` table, crons, R2
bucket, and secrets:

- **Shorts (format 1, Phase 1)** — one 9:16 short per clean-license verse:
  Google Cloud TTS reads the **translation** aloud (never the Sanskrit chant),
  Remotion renders text-on-color visuals, and scheduled crons separate render
  (Cron A) from upload (Cron B). Scope: **149 English-only videos** (Siva
  Sutras 77 + Spanda Karikas 52 + Pratyabhijna Hrdayam 20). Indic languages
  are Phase 2, gated on the day-30 kill-switch thresholds in
  `docs/YOUTUBE-PIPELINE-PLAN.md`.
- **Chapter videos (format 2)** — one 16:9 (1920×1080 @ 30fps) video per
  (text, chapter) playing every verse in sequence (narrated title card →
  per-verse segments → end-screen-safe outro), rendered by Cron A2 and
  upload-held behind `chapters.uploads_enabled`. Scope: **8 English videos**
  (siva-sutras ch1–3, spanda-karikas ch1–4, pratyabhijna-hrdayam ch1);
  governance in `docs/YOUTUBE-PIPELINE-PLAN.md` → Chapter Videos (Format 2).

This document is the operator's map: the data-flow, the `videos` lifecycle
state machine, the secrets inventory, and the key-rotation cadence.

---

## Data flow

```
                          data/youtube-config.yaml
                          (text→kula→preset, voices,
                           license + palette gates,
                           chapters: block — format 2)
                                    │
                                    ▼
  corpus DB ───────────►  youtube-backfill-pending.ts  ──────►  videos table
  (translations,         (idempotent INSERT OR IGNORE,           (status='pending')
   getVerseAllLanguages)  min_translation_status floor)
                                    │
        ┌───────────────────────────┘
        │
        ▼
┌───────────────────────────────  CRON A — generate (0 */6 * * *)  ───────────────────────────────┐
│  youtube-render.ts --limit=50                                                                    │
│   pick: format='short' AND (pending OR failed&retry_count<3)                                     │
│   per row:                                                                                       │
│     ┌──────────┐   ┌──────────────────┐   ┌──────────┐   ┌──────────────┐   ┌──────────────┐     │
│     │ Google   │──►│ Remotion render   │──►│ QA gates │──►│ R2 put       │──►│ DB update    │     │
│     │ Cloud    │   │ (Short.tsx +      │   │ >100KB,  │   │ videos/<...>/ │   │ status:      │     │
│     │ TTS      │   │  EB Garamond +    │   │ 6–182s,  │   │ <md5>.mp4    │   │ rendered →   │     │
│     │ (WAV)    │   │  Noto Serif Dev.) │   │ >-40LUFS,│   │ (ETag==md5)  │   │ approved     │     │
│     └──────────┘   └──────────────────┘   │ h264+aac │   └──────────────┘   └──────────────┘     │
│                                            └──────────┘                                           │
│   MOCK_ALL=true → canned WAV + canned PNG, real MP4, zero secrets (see mocks/)                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │  artifact in R2 (sohamhamso-backups)
                                    ▼
┌───────────────────────────────  CRON B — upload (30 */4 * * *)  ────────────────────────────────┐
│  youtube-upload.ts                                                                               │
│   pre-check youtube_quota (skip if units_spent today > 8000)                                     │
│   chapter rows HELD while chapters.uploads_enabled=false (operator-named log line)               │
│   pull oldest: status='approved' AND youtube_video_id IS NULL                                    │
│   chapter rows: fetch chapters/<…>.meta.json sidecar FIRST — missing sidecar fails loudly        │
│   R2 → /tmp/upload.mp4 → videos.insert (unlisted, localized title/desc/tags per lang;            │
│   chapter rows: timestamp block from sidecar, retry ONCE on network error w/ fresh stream)       │
│   post-upload sha256(remote) == output_file_sha256  ──►  status='uploaded', youtube_quota++      │
│   403 quotaExceeded → exhausted=1, exit 0 (graceful)                                              │
│   channel-not-verified (>15min upload) → named no-retry error, retry_count NOT burned             │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                    │  unlisted video live on @sohamhamso
                                    ▼
                       Operator reviews in YouTube Studio
                       youtube-revisit.ts --video-id=N --visibility=public
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
  CRON D — digest            CRON E — analytics           lease sweep (hourly)
  (0 12 * * *)               (0 5 * * *)                  youtube-lease-sweep.ts
  youtube-status.ts --json   youtube-analytics-sync.ts    rendering/uploading_lease_at
  → ops Issue (+ Slack)      → video_analytics table      stale → status='failed'
  (incl. byFormat counts)    (metric-honesty contract,    TTL: 1h shorts / 4h chapters
                              see below)                  supersede sweep (E2):
                                                          superseded >30d → auto-private
```

Chapter flow (format 2 — same state DB, same R2 bucket, same Cron B):

```
                  youtube-backfill-chapters.ts
                  (workflow_dispatch ONLY — never local: the R2 state-DB push is
                   last-writer-wins. Per text × chapter × chapters.langs: per-verse
                   status-priority translation pick → manifest → chapterContentMd5
                   → shouldSkipRender / markSuperseded)
                                    │  insertPending(format='chapter', verse_num=0)
                                    ▼
┌──────────────────────  CRON A2 — generate-chapters (0 3,15 * * *)  ──────────────────────────┐
│  youtube-render-chapters.ts --limit=2      (timeout-minutes: 330, youtube-pipeline group)    │
│   pick: format='chapter' AND (pending OR (failed AND retry_count<3                           │
│         AND last_error_phase != 'upload'))   — upload failures never trigger a re-render     │
│   per row (renderChapterOne):                                                                │
│     stored md5 vs live chapterContentMd5 — mismatch → superseded + skip (no retry loop)      │
│     → per-verse TTS (retry ×2; errors name the verse) → per-segment data-URL audio           │
│     → Remotion 'Chapter' (title card → verse <Sequence>s → outro) → encode cbr8|crf18        │
│     → QA CHAPTER_LIMITS: >5MB, >-40 LUFS, h264+aac, |probed − expected| ≤ 2s (no length cap) │
│     → R2 atomic pair: chapters/<…>.mp4 + .meta.json sidecar → DB rendered → approved         │
│   exits NON-ZERO when any row reaches MAX_RETRY → the if:failure() issue step actually fires │
│   (failure issues carry the --video-id=N --keep-workdir repro + --reset-retries recovery)    │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

R2 layout (bucket `sohamhamso-backups`, S3-compatible via `AWS_*`/`R2_*`):

```
videos/<text>/<chapter>/<verse>/<lang>/<md5>.mp4    # md5 = translation_md5, immutable
videos/<text>/<chapter>/<verse>/<lang>/<md5>.thumb.jpg
videos/<text>/<chapter>/<verse>/<lang>/<md5>.meta.json
chapters/<text>/<chapter>/<lang>/<md5>.mp4          # md5 = chapterContentMd5(manifest)
chapters/<text>/<chapter>/<lang>/<md5>.meta.json    # timestamp/provenance sidecar (atomic pair)
manifests/videos-index.json
```

The `videos/` and `chapters/` prefixes can never collide. The chapter sidecar
is the uploader's timestamp source and the row's full per-verse provenance —
written as an **atomic pair** with the mp4 (a sidecar-put failure fails the
render; re-running re-puts both under the same immutable keys). Shape
(`chapter-render-engine.ts::ChapterSidecar`):

```jsonc
{
  "segments": [
    { "verse_num": 1, "startS": 5.0, "durationS": 14.2,
      "translation_row_id": 412, "translation_md5": "…" }
    // … one per verse, ordered
  ],
  "durationS": 312.4,
  "verseCount": 7,
  "lang": "en",
  "voiceId": "en-US-Studio-O",
  "templateVersion": "c1",
  "manifestMd5": "…",
  "outroStartS": 303.4        // start of the outro card — the uploader's final timestamp line
}
```

---

## `videos` state machine

```
                 backfill (INSERT OR IGNORE)
                          │
                          ▼
                     ┌─────────┐
                     │ pending │◄────────────────────────────┐
                     └────┬────┘                             │
        Cron A picks up   │                                  │ retry_count<3
        (sets rendering_  ▼                                  │ (Cron A re-pick)
         lease_at)   ┌───────────┐    QA fail / crash        │
                     │ rendering │───────────────────────────┤
                     └─────┬─────┘                            │
            QA pass        │            lease stale           │
                          ▼             (lease sweep, E4)     │
                     ┌──────────┐ ───────────────────────────┘
                     │ rendered │
                     └────┬─────┘
        auto-approve on    │            (manual)
        QA pass            ▼            ┌──────────┐
                     ┌──────────┐ ─────►│ rejected │  (terminal — operator reject)
                     │ approved │       └──────────┘
                     └────┬─────┘
        Cron B picks up    │
        (sets uploading_   ▼
         lease_at)   ┌───────────┐    upload fail / crash
                     │ uploading │──────────────────────────► failed → pending (retry)
                     └─────┬─────┘     (lease stale → sweep)
        videos.insert OK   │
        + sha256 match     ▼
                     ┌──────────┐
                     │ uploaded │  (terminal-ish: append-only, no mutating updates)
                     └────┬─────┘
                          │  translation edit (md5 changes) OR template bump
                          ▼
                     ┌────────────┐   new row inserted as 'pending';
                     │ superseded │   old YouTube video NOT auto-deleted.
                     └────────────┘   supersede sweep (E2): auto-private after 30d.
```

States (DB CHECK constraint): `pending`, `rendering`, `rendered`, `approved`,
`rejected`, `uploading`, `uploaded`, `failed`, `superseded`.

**Chapter-format deltas** (`format='chapter'`, `verse_num=0` — corpus verses
start at 1, so the existing UNIQUE key needs no change):

1. **Render queue** excludes failed rows with `last_error_phase='upload'` —
   a failed YouTube upload must never trigger a 90-minute re-render (the R2
   mp4 is fine; Cron B retries, or the operator requeues with
   `youtube-revisit.ts --video-id=N --reset-retries`).
2. **Lease TTL is 4h** for chapter rows (vs 1h shorts) in the hourly sweep —
   a chapter render routinely runs 30–90 min, so the 1h TTL would sweep live
   renders out from under the renderer.
3. **Upload hold gate** — `approved` chapter rows are held by Cron B until
   `chapters.uploads_enabled: true` in `data/youtube-config.yaml`. Enforced in
   code, not policy: the uploader logs
   `N chapter rows held (chapters.uploads_enabled=false — flip in
   data/youtube-config.yaml and push to main)`. Renders/QA/R2 proceed
   regardless, so the queue is fully staged when the operator flips the gate
   after the 30-day shorts measurement window closes (checklist:
   `scripts/youtube/README.md` → Window-close checklist).
4. **md5 mismatch at render time** → `superseded` + skip — never the
   failed/retry loop (3 × 90 min of wasted CI). The replacement row is
   inserted by the next backfill dispatch, and the batch summary counts
   `superseded awaiting backfill: N`.

Determinism contract (replaces the dropped `input_hash` keystone): each row
stores `translation_md5` and `template_version`. Re-render rule — query the
latest row by `(text_id, chapter, verse_num, lang, short_index)`; **skip** if
`status IN ('rendered','approved','uploaded')` AND `translation_md5` AND
`template_version` all match; otherwise mark the old row `superseded` and
insert a new `pending` row. The two fields are format-specific:

- **Shorts**: `translation_md5` = md5 of the translation text at render time;
  `template_version` = `pipeline/youtube/versions.ts::TEMPLATE_VERSION`
  (`'v2'`).
- **Chapters**: `translation_md5` = `determinism.ts::chapterContentMd5()` —
  md5 of the JSON-serialized per-verse **manifest** `{verse_num, devanagari,
  iast, translation_text, translation_row_id, tts_voice_id}` ordered by
  `verse_num` (the same manifest persisted in the sidecar). Hashing the
  manifest — not just text tuples — means a translation edit, a
  translation-row swap, a voice change, or a verse reordering all cascade a
  chapter re-render. `template_version` =
  `versions.ts::CHAPTER_TEMPLATE_VERSION` (`'c1'`) — an **independent version
  track**: bumping one format's template never cross-supersedes the other.

**One-time cascade exemption (documented):** making the shared
`Background`/`Footer`/`Translation` components landscape-capable used
**default-preserving props** — every new prop defaults to the old hardcoded
portrait constant, so Short output stays byte-identical and the shorts
`TEMPLATE_VERSION` was deliberately NOT bumped (avoiding a 149-video
supersede/re-render cascade). The exemption is locked by the golden-frame
test and `tests/unit/youtube/template-version.test.ts`.

---

## Per-format translation floor

Floors are resolved per (text, format) in
`pipeline/youtube/eligibility.ts::translationFloorFor`:

- **Shorts** keep each text's `min_translation_status` (`reviewed`) —
  unchanged from Phase 1.
- **Chapters** use the global `chapters.min_translation_status` (`draft` in
  v1), which makes all 8 chapter combos complete without touching the corpus.

This is a **video-pipeline floor, not a corpus mutation** —
`STATUS-CONTRACT.md` semantics (`reviewed` = human-reviewer accepted) are
untouched. The chapter backfill additionally requires a **non-empty**
translation for every verse (skip + report otherwise) and picks each verse's
translation by explicit status priority (published → reviewed → draft), never
alphabetical `ORDER BY status`.

---

## Chapter audio: per-segment data URLs

The Chapter composition mounts one `<Audio>` per verse `<Sequence>` (plus the
title card), each fed a **base64 data-URL** of that verse's narration — the
exact `Short.tsx` + `audioFileToDataUrl` pattern (`renderMedia` here fetches
only http(s)/staticFile/data URLs). Consequences: no per-video temp
`publicDir`, fonts keep resolving from the repo's `public/` as today, and the
**Remotion bundle stays safely reusable across a batch** (no per-video static
assets; the bundle/serveUrl is cached per process). Frame-math contract: each
segment span is rounded to integer frames first, then the integers are summed
(`chapter-props.ts::computeChapterTiming`, unit-tested against a 163-verse
synthetic input) — audio can never drift from video.

A single concatenated narration track is built ONLY by
`youtube-render-chapters.ts --audio-only` (PCM-exact: each verse decoded and
padded/truncated to its sidecar segment slot, concatenated, encoded once) for
the multi-audio-track test. It mutates nothing (no DB, no R2).

---

## Analytics metric honesty (Cron E contract)

`youtube-analytics-sync.ts` fills only what the YouTube Analytics API can
honestly report, per uploaded video over a trailing 30-day window, upserted
into `video_analytics` keyed on `(video_id, UTC date)`:

| Metric class | Columns | Source |
|---|---|---|
| **API-fillable** | `view_count`, `watch_time_s` (= averageViewDuration, mean s/view), `completion_rate` (= averageViewPercentage), `subscribers_gained` | YouTube Analytics API (`yt-analytics.readonly`) |
| **Studio-only** | `ctr` (impressions CTR), `retention_3s` (Shorts 3s-retention) | NOT in the API — stays **NULL**, read manually in YouTube Studio |
| **Site-side** | `link_clicks_utm` | a site-analytics metric, not a YouTube one — stays **NULL** until site-side UTM ingestion exists (a named gap, never silently "measured") |

NULL means *not measured* — these columns are never zero-filled, and the
honesty line is logged on every run so the digest/kill-switch reader is never
misled. `audio_lang` stays NULL until the multi-audio-track test fills it. A
403 insufficient-scope exits 1 immediately with the named re-auth fix (no
retry storm).

---

## Secrets inventory

| Variable | Purpose | Where set |
|----------|---------|-----------|
| `GOOGLE_TTS_CREDENTIALS_JSON` | Google Cloud TTS service-account JSON; synthesizes narration WAV | Repo Actions secret → Cron A + A2 env |
| `YOUTUBE_OAUTH_CLIENT_ID` | OAuth client id for the @sohamhamso channel | Repo Actions secret → Cron B + E env |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | OAuth client secret | Repo Actions secret → Cron B + E env |
| `YT_REFRESH_TOKEN` | Long-lived refresh token, **3-scope union**: `youtube.upload` + `yt-analytics.readonly` + `youtube.force-ssl` (never the full `youtube` scope) | Repo Actions secret → Cron B + E env (minted by `youtube-oauth-setup.ts`) |
| `R2_BUCKET` | Target R2 bucket name (`sohamhamso-backups`) | Repo Actions secret → render/upload/analytics/sweep cron env (artifacts + state DB) |
| `AWS_ACCESS_KEY_ID` | R2 S3-compatible access key | same |
| `AWS_SECRET_ACCESS_KEY` | R2 S3-compatible secret key | same |
| `AWS_ENDPOINT_URL` | R2 S3 endpoint URL | same |
| `SLACK_WEBHOOK_URL` | *(optional)* mirror the daily digest to Slack | Repo Actions secret → Cron D env (step gated on presence) |

All `process.env.GOOGLE_TTS_*` / `YOUTUBE_*` / `AWS_*` reads go through
`pipeline/youtube/secrets.ts` (single chokepoint, hard-fail in prod). No secret
is read elsewhere. `last_error` is scrubbed via `pipeline/youtube/log.ts::scrubError()`
before any DB write (E6): service-account paths, `AKIA*` keys, `ya29`/`1//`
OAuth tokens, and 30+-char Indic substrings are stripped.

---

## OAuth / key rotation cadence (quarterly)

Rotate `YT_REFRESH_TOKEN` and the R2 access keys **quarterly** (every 3 months).
The token carries the locked **3-scope union** — `youtube.upload` (Cron B) +
`yt-analytics.readonly` (Cron E) + `youtube.force-ssl` (`videos.update`:
revisit flip-public, supersede-sweep auto-private, update-seo) — and never the
full `youtube` scope (no channel / comment / playlist mutation beyond those
explicit paths). Rotating in a token granted fewer than all three scopes
regresses Cron E and every `videos.update` caller on their next fire — the
setup script prints the GRANTED scopes and warns loudly on a short grant.

The step-by-step playbook lives in `scripts/youtube/README.md` (Quarterly
OAuth rotation); `bun scripts/youtube-oauth-setup.ts --refresh` prints it. In
short:

1. `bun scripts/youtube-oauth-setup.ts` → consent URL; re-run with
   `--code=PASTED_CODE` → fresh token at `.secrets/yt-refresh.txt`. Verify the
   printed GRANTED scopes include all three.
2. `gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt` — one atomic
   secret swap between cron fires (the old token stays valid until revoked,
   so in-flight runs are never stranded).
3. Revoke the old token at `console.cloud.google.com/apis/credentials`.
4. Log the rotation to `pipeline_runs` with `phase='rotation'` (manual).

Anomaly detection complements rotation: the Cron D digest alarms if
`uploads_per_hour > 20`, catching a compromised key within ~4h rather than at the
24h daily-quota boundary. A second human admin on the @sohamhamso Brand Account
(bus-factor) is documented in `scripts/youtube/README.md` (Channel Handover).
