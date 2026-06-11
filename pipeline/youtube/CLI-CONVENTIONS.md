# YouTube Pipeline — CLI Conventions (D3)

Every `scripts/youtube-*.ts` entry point conforms to this shared flag spec, so
an operator can run any of them the same way and pipe their output into other
tools predictably. Argv is parsed manually (no commander dep), mirroring the
existing `pipeline/embed/runner.ts` / `scripts/seo-*.ts` conventions.

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
| `--json` | bool | Emit machine-readable JSON to stdout instead of human text. Logs/diagnostics go to stderr so stdout stays clean JSON. |
| `--dry-run` | bool | Plan only — no side effects (no TTS spend, no Remotion render, no R2 writes, no `videos.insert`, no DB mutations). Prints what *would* happen. |
| `--limit=N` | int | Cap the number of rows processed this invocation. Cron A uses `--limit=50`. Default per-script (commonly all eligible). |
| `--text-slug=SLUG` | string | Restrict to a single text (e.g. `siva-sutras`). Used by Cron A dispatch. |
| `--lang=CODE` | string | Restrict to a single lang code (e.g. `en`). Used by Cron A dispatch. |
| `--force` | bool | Re-process even when the determinism contract (`translation_md5` + `template_version`) matches. Use sparingly; supersedes the prior row for the audit trail. |

Unknown flags are an error (exit 2). Flags use `--flag=value` form for values;
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
row reaches MAX_RETRY in the run — per-row failures are never silently exit 0,
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

Human logs go to **stderr**; `--json` payloads go to **stdout**. This keeps
`bun scripts/youtube-status.ts --json | jq …` clean even while the script logs
progress.

---

## `MOCK_ALL` behavior

`MOCK_ALL=true` swaps every external dependency for a zero-secret canned
substitute (see `pipeline/youtube/mocks/`). Behavior:

- **No secrets required** — `secrets.ts` does not hard-fail; TTS/YouTube/R2
  clients are never constructed.
- **Google TTS** → `cannedSilentWav(seconds)` returns a valid PCM WAV of silence.
- **Background image / thumbnail** → `cannedImagePng()` returns a tiny valid PNG.
- **Remotion** still runs and produces a **real MP4** from the canned WAV + PNG,
  so the artifact, QA gates, and filename builder all exercise real code paths.
- **R2 put** → writes to a local temp dir instead of the network.
- **YouTube `videos.insert`** → returns a fake `youtube_video_id`; no upload.
  Chapter rows get a **canned timestamp sidecar** so the metadata/timestamp
  paths run end-to-end.
- **YouTube Analytics API** → no call; a canned report flows through the real
  mapper + upsert, writing one fixture row.

This is the Day-0 contributor path: `MOCK_ALL=true bun scripts/youtube-render.ts`
(or the tts smoke) produces a real MP4 with **no credentials**. TTHW (time to
first artifact for a fresh contributor) target: **< 10 minutes**.

The chapter format honors the same Day-0 contract:

```bash
MOCK_ALL=true bun run youtube:render-chapter-samples
```

renders **real 16:9 chapter MP4s** (plus per-render `.timing.json` pacing
sidecars) through the real `Chapter` composition and `buildChapterProps`
mapper from canned silent WAV — zero secrets, no R2/DB writes. Real-TTS
samples are the second step and need only `GOOGLE_TTS_CREDENTIALS_JSON`.

`--dry-run` and `MOCK_ALL` are orthogonal: `--dry-run` skips work entirely
(plan only); `MOCK_ALL` does the work against canned inputs.
