# YouTube Pipeline — CLI Conventions (D3)

The lifecycle scripts share parsing helpers in `cli.ts`; script-specific
`--help` remains the authoritative list of accepted flags and effects. Some
sample, OAuth, and maintenance tools parse their own arguments, so do not
assume every accepted shared flag has an effect in every script. This
reference was checked against `origin/main` (`4c94bf2`) on 2026-10-12.

Scripts covered: `youtube-render.ts`, `youtube-upload.ts`, `youtube-status.ts`,
`youtube-revisit.ts`, `youtube-lease-sweep.ts`, `youtube-supersede-sweep.ts`,
`youtube-backfill-pending.ts`, `youtube-validate-config.ts`,
`youtube-oauth-setup.ts`, `youtube-tts-smoke.ts`, `youtube-update-seo.ts`, and
the chapter-format (format 2) + analytics scripts:
`youtube-render-chapter-samples.ts`, `youtube-backfill-chapters.ts`,
`youtube-render-chapters.ts`, `youtube-analytics-sync.ts`.

Script-specific extras stay in `--flag=value` form and are documented in each
script's `--help`: e.g. `--chapter=N` (backfill/samples), `--variant=LABEL`
`--full` `--out=DIR` (samples), `--video-id=N` `--keep-workdir` `--audio-only`
`--sidecar=PATH` (render-chapters), `--days=N` (analytics-sync),
`--reset-retries` (revisit).

---

## Shared flags

| Flag | Type | Meaning |
|------|------|---------|
| `--help` | bool | Print usage (flags, examples, exit codes) to stdout and exit 0. Every script implements this. |
| `--json` | bool | Request JSON summary; does not suppress effects. Shared logs use stderr, but sample-renderer/provider progress may also use stdout. |
| `--dry-run` | bool | Suppress processing effects in scripts that implement it; some still open a writable SQLite handle or ensure schema. Use an isolated DB. Consult per-script help. |
| `--limit=N` | int | Cap the number of rows processed this invocation. Cron A uses `--limit=50`. Default per-script (commonly all eligible). |
| `--text-slug=SLUG` | string | Restrict to a single text (e.g. `siva-sutras`). Used by Cron A dispatch. |
| `--lang=CODE` | string | Restrict to a single lang code (e.g. `en`). Used by Cron A dispatch. |
| `--force` | bool | Parsed by the shared helper; behavior is script-specific. Do not assume every consumer uses it to override determinism. |

The shared parser rejects unknown flags (exit 2); independently parsed tools may differ. Flags use `--flag=value` form for values;
boolean flags take no value.

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success. Also used for *expected, non-error* terminal conditions — e.g. Cron B hitting a 403 `quotaExceeded` sets `exhausted=1` and exits 0 (not a failure; the next fire resumes). |
| `1` | Runtime failure (TTS error, render crash, R2 write failure, DB error). Triggers the workflow's `if: failure()` issue-on-failure step. |
| `2` | Usage error (unknown flag, missing required arg, malformed input). |
| `3` | Config / gate failure (Zod validation, forbidden palette/iconography, license gate, `min_translation_status` floor not met, `--audio-only` row/sidecar gate). |

Chapter nuance: `youtube-render-chapters.ts` exits **non-zero (1)** when any
row reaches MAX_RETRY in the run — retry-exhausted failures cause a nonzero batch result,
so the workflow's `if: failure()` issue step actually fires.

---

## Log prefix

Every log line is prefixed with the stage tag `[youtube:<stage>]`, where
`<stage>` is one of `plan`, `render`, `probe`, `upload`, `status`, `rotation`,
`sweep`, `config`, `analytics-sync`, `chapter-samples`. The chapter scripts
reuse the shared stages: `youtube-backfill-chapters.ts` logs under `plan`,
`youtube-render-chapters.ts` and the chapter render engine under `render`.
Examples:

```
[youtube:plan]   picked 50 rows (pending=48 failed-retry=2)
[youtube:render] siva-sutras 1.1 en — TTS 2.1s, Remotion 14.8s
[youtube:probe]  QA pass — 18.2s, h264+aac, -22.4 LUFS, 1.4MB
[youtube:upload] inserted youtube_video_id=abc123 (unlisted)
[youtube:upload] 3 chapter rows held (chapters.uploads_enabled=false — flip in data/youtube-config.yaml and push to main)
[youtube:status] rendered=1 approved=0 uploaded=0 pending=148
[youtube:render] superseded awaiting backfill count=1 next=dispatch youtube-backfill-chapters
[youtube:analytics-sync] metric honesty: API fills view_count, watch_time_s … (logged every run)
[youtube:chapter-samples] rendered file=spanda-karikas-ch2.mp4 …
```

The held line and the `superseded awaiting backfill` count are
operator-actionable contracts (uploader hold gate, verse-edit → backfill
loop) — see `scripts/youtube/README.md` (Chapter videos).

Shared human logs go to **stderr**; `--json` payloads go to **stdout**.
Render dependencies can print their own progress to stdout; check output
before treating a full rendering command as clean JSON. Status output keeps
`bun scripts/youtube-status.ts --json | jq …` clean even while the script logs
progress.

---

## `MOCK_ALL` behavior

`MOCK_ALL=true` swaps every external dependency for a zero-secret canned
substitute (see `pipeline/youtube/mocks/`). Behavior:

- **No secrets required** — `secrets.ts` does not hard-fail; TTS/YouTube/R2
  clients are never constructed.
- **Google TTS** → `cannedSilentWav(seconds)` returns a valid PCM WAV of silence.
- **Production render engines** write padded WAV byte fixtures under `.mp4`
  filenames and use assumed probe values; no Remotion/Chromium runs there.
  These fixtures verify orchestration, hashes, and state, not real media.
- **Sample renderers** run actual Remotion/Chromium using silent audio and
  produce decodable local MP4. Silence fails a real production loudness gate.
- **PNG fixture** → `cannedImagePng()` is an exported tiny image helper, not
  an exercised AI-background pipeline.
- **R2 put** → writes to a local temp dir instead of the network.
- **YouTube `videos.insert`** → returns a fake `youtube_video_id`; no upload.
  Chapter rows get a **canned timestamp sidecar** so the metadata/timestamp
  paths run end-to-end.
- **YouTube Analytics API** → no call; a canned report flows through the real
  mapper + upsert, writing one fixture row.

The production mock path requires an isolated `YOUTUBE_DB_PATH` because it
mutates local lifecycle state. `youtube-tts-smoke.ts` produces audio fixtures,
not video. The historical ten-minute onboarding target is not a measured
latency claim. See the [mock reference](mocks/README.md).

The chapter format honors the same Day-0 contract:

```bash
MOCK_ALL=true bun run youtube:render-chapter-samples
```

renders **real 16:9 chapter MP4s** (plus per-render `.timing.json` pacing
sidecars) through the real `Chapter` composition and `buildChapterProps`
mapper from canned silent WAV — zero secrets, no R2/DB writes. Real-TTS
samples are the second step and need only `GOOGLE_TTS_CREDENTIALS_JSON`.

`--dry-run` and `MOCK_ALL` are orthogonal: `--dry-run` suppresses processing
effects where implemented; `MOCK_ALL` performs local work against fixtures
and can mutate local files/state. `--json` controls presentation only.
