# YouTube Shorts Pipeline — Architecture (D2)

Phase 1 turns each clean-license scripture verse into a short YouTube video:
Google Cloud TTS reads the **translation** aloud (never the Sanskrit chant),
Remotion renders text-on-color visuals, and scheduled crons separate render
(Cron A) from upload (Cron B). This document is the operator's map: the
data-flow, the `videos` lifecycle state machine, the secrets inventory, and the
key-rotation cadence.

Scope reminder: Phase 1 is **149 English-only videos** (Siva Sutras 77 + Spanda
Karikas 52 + Pratyabhijna Hrdayam 20). Indic languages are Phase 2, gated on the
day-30 kill-switch thresholds in `docs/YOUTUBE-PIPELINE-PLAN.md`.

---

## Data flow

```
                          data/youtube-config.yaml
                          (text→kula→preset, voices,
                           license + palette gates)
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
│   pick: status='pending' OR (status='failed' AND retry_count<3)                                  │
│   per row:                                                                                       │
│     ┌──────────┐   ┌──────────────────┐   ┌──────────┐   ┌──────────────┐   ┌──────────────┐     │
│     │ Google   │──►│ Remotion render   │──►│ QA gates │──►│ R2 put       │──►│ DB update    │     │
│     │ Cloud    │   │ (Short.tsx +      │   │ >100KB,  │   │ videos/<...>/ │   │ status:      │     │
│     │ TTS      │   │  EB Garamond +    │   │ 15–60s,  │   │ <md5>.mp4    │   │ rendered →   │     │
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
│   pull oldest: status='approved' AND youtube_video_id IS NULL                                    │
│   R2 → /tmp/upload.mp4 → videos.insert (unlisted, localized title/desc/tags per lang)            │
│   post-upload sha256(remote) == output_file_sha256  ──►  status='uploaded', youtube_quota++      │
│   403 quotaExceeded → exhausted=1, exit 0 (graceful)                                              │
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
  youtube-status.ts --json   YouTube Analytics API        rendering/uploading_lease_at
  → ops Issue (+ Slack)      → video_analytics table      >1h → status='failed'
                                                          supersede sweep (E2):
                                                          superseded >30d → auto-private
```

R2 layout (bucket `sohamhamso-backups`, S3-compatible via `AWS_*`/`R2_*`):

```
videos/<text>/<chapter>/<verse>/<lang>/<md5>.mp4    # md5 = translation_md5, immutable
videos/<text>/<chapter>/<verse>/<lang>/<md5>.thumb.jpg
videos/<text>/<chapter>/<verse>/<lang>/<md5>.meta.json
manifests/videos-index.json
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
            QA pass        │            lease >1h             │
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
                     └─────┬─────┘     (lease >1h → sweep)
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

Determinism contract (replaces the dropped `input_hash` keystone): each row
stores `translation_md5` (md5 of the translation text at render time) and
`template_version` (frozen `pipeline/youtube/versions.ts::TEMPLATE_VERSION`).
Re-render rule — query the latest row by `(text_id, chapter, verse_num, lang,
short_index)`; **skip** if `status IN ('rendered','approved','uploaded')` AND
`translation_md5` AND `template_version` all match; otherwise mark the old row
`superseded` and insert a new `pending` row.

---

## Secrets inventory

| Variable | Purpose | Where set |
|----------|---------|-----------|
| `GOOGLE_TTS_CREDENTIALS_JSON` | Google Cloud TTS service-account JSON; synthesizes narration WAV | Repo Actions secret → Cron A env |
| `YOUTUBE_OAUTH_CLIENT_ID` | OAuth client id for the @sohamhamso channel | Repo Actions secret → Cron B + E env |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | OAuth client secret | Repo Actions secret → Cron B + E env |
| `YT_REFRESH_TOKEN` | Long-lived refresh token, scope `youtube.upload` only | Repo Actions secret → Cron B + E env (minted by `youtube-oauth-setup.ts`) |
| `R2_BUCKET` | Target R2 bucket name (`sohamhamso-backups`) | Repo Actions secret → Cron A + B env |
| `AWS_ACCESS_KEY_ID` | R2 S3-compatible access key | Repo Actions secret → Cron A + B env |
| `AWS_SECRET_ACCESS_KEY` | R2 S3-compatible secret key | Repo Actions secret → Cron A + B env |
| `AWS_ENDPOINT_URL` | R2 S3 endpoint URL | Repo Actions secret → Cron A + B env |
| `SLACK_WEBHOOK_URL` | *(optional)* mirror the daily digest to Slack | Repo Actions secret → Cron D env (step gated on presence) |

All `process.env.GOOGLE_TTS_*` / `YOUTUBE_*` / `AWS_*` reads go through
`pipeline/youtube/secrets.ts` (single chokepoint, hard-fail in prod). No secret
is read elsewhere. `last_error` is scrubbed via `pipeline/youtube/log.ts::scrubError()`
before any DB write (E6): service-account paths, `AKIA*` keys, `ya29`/`1//`
OAuth tokens, and 30+-char Indic substrings are stripped.

---

## OAuth / key rotation cadence (quarterly)

Rotate `YT_REFRESH_TOKEN` and the R2 access keys **quarterly** (every 3 months).
Blast radius is minimized by the `youtube.upload`-only scope (no channel /
comment / playlist mutation). The step-by-step playbook lives in
`scripts/youtube/README.md` (OAuth Rotation). In short:

1. `bun scripts/youtube-oauth-setup.ts --refresh` → mints a new refresh token.
2. `gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt`.
3. Revoke the old token at `console.cloud.google.com/apis/credentials`.
4. Log the rotation to `pipeline_runs` with `phase='rotation'`.

Anomaly detection complements rotation: the Cron D digest alarms if
`uploads_per_hour > 20`, catching a compromised key within ~4h rather than at the
24h daily-quota boundary. A second human admin on the @sohamhamso Brand Account
(bus-factor) is documented in `scripts/youtube/README.md` (Channel Handover).
