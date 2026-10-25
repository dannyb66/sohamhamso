# YouTube pipeline architecture

**Baseline:** `origin/main` (`4c94bf2`), checked 2026-10-12. The authoritative implementation reference is [AI video and YouTube platform](../../docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md); this file is the compact subsystem map. See the [operator handbook](../../scripts/youtube/README.md) for procedures and [decision 004](../../docs/decisions/004-media-lifecycle-recovery.md) for reconstructed rationale.

## Components and current rollout

Both formats use the corpus, voice/style YAML, writable `videos` lifecycle DB, R2 bucket, and upload/analytics scripts:

- **Shorts:** `Short`, 1080×1920, one verse; configured eligible scope is Śiva Sūtras, Spanda Kārikās, Pratyabhijñā Hṛdayam. 149 is the historical verse target, not a published-video count or verified count clearing the translation floor.
- **Chapters:** `Chapter`, 1920×1080, one ordered chapter, narrated title and verse segments, quiet outro. Baseline config selects English and holds uploads with `chapters.uploads_enabled: false`.
- **Publishing:** baseline single-channel `@sohamhamso` OAuth; the upload workflow's cron is commented out, and manual dispatch remains enabled. Per-language channel routing/Azure speech are branch-only at [8aa582f](https://github.com/dannyb66/sohamhamso/commit/8aa582f2ec2477c9ac4f821d13f61e6f5717931d).

## Execution and data boundaries

```text
corpus SQLite (read-only) + youtube-config.yaml
    -> backfill eligibility / chapter manifest
    -> lifecycle SQLite (pending row)
    -> Google TTS translation narration
    -> Remotion props + composition -> FFmpeg encode + probe
    -> R2 media (chapter also requires timestamp/provenance JSON)
    -> approved row -> uploader -> unlisted YouTube video
    -> Studio review -> explicit public visibility update
    -> Analytics API -> lifecycle analytics records
```

Implemented boundaries:

| Boundary | Contract |
| --- | --- |
| Corpus | `src/lib/db.ts`; Sanskrit/IAST and translation row references |
| Mutable state | `src/lib/videos-db.ts`; Actions sets `YOUTUBE_DB_PATH=db/youtube-state.db` |
| State persistence | `scripts/youtube-state-db.sh`: pull/push `state/youtube-state.db` in R2, last-writer-wins |
| Serialization | All participating Actions workflows use `youtube-pipeline`, `cancel-in-progress: false`; no distributed locking outside this group |
| Short orchestration | `render-engine.ts`; TTS → render → encode/probe → R2 put → QA → rendered/approved |
| Chapter orchestration | `chapter-render-engine.ts`; live manifest check → per-verse TTS → render/encode → QA → MP4 and sidecar puts → approved |
| Upload | `scripts/youtube-upload.ts`; downloaded artifact SHA-256 validation → metadata/sidecar → `videos.insert` |

Mutable video state uses SQLite. Locally the video DB API falls back to `db/sohamhamso.db` if neither DB override is set; use an explicit disposable `YOUTUBE_DB_PATH` for exercises. A production-state file uploaded locally can clobber intervening Actions changes. Failed R2 pulls are treated as fresh state, so diagnose credential/network errors before accepting a seeded DB.

## Artifact contract and integrity limits

```text
videos/<text>/<chapter>/<verse>/<lang>/<translation-md5>.mp4
chapters/<text>/<chapter>/<lang>/<manifest-md5>.mp4
chapters/<text>/<chapter>/<lang>/<manifest-md5>.meta.json
state/youtube-state.db
```

Chapter JSON includes per-verse start/duration, translation row ID/hash, total duration, verse count, language, voice, template version, manifest hash, and outro start. It does not persist the full Sanskrit/translation text manifest. Both MP4 and JSON must be written before approval; the sequential puts are not an atomic R2 transaction. A failed JSON put can leave an unapproved MP4, and retry re-puts both.

The Short engine uploads before its QA check and can retain a failed artifact key. Its ETag check compares local MD5 to itself; no renderer reads a remote R2 ETag. Chapters disable that check. The uploader checks downloaded R2 bytes against stored SHA-256 **before** uploading; it does not verify YouTube's transcoded bytes. Keys omit template version, so a template-only rerender can overwrite the same path.

QA checks actual FFmpeg-probed codecs/duration/loudness on the real render path: Shorts >100,000 bytes, 6–182 seconds, >−40 LUFS, H.264/AAC; chapters >5,000,000 bytes, >−40 LUFS, H.264/AAC and measured/expected duration difference ≤2 seconds. These checks do not establish translation quality or speech pronunciation.

## Lifecycle and recovery

Status values: `pending`, `rendering`, `rendered`, `approved`, `rejected`, `uploading`, `uploaded`, `failed`, `superseded`. The schema checks membership, not every transition edge.

Content/template reuse requires matching hash/version and `rendered|approved|uploaded` state. Short content hashes translation text; chapter hashes its ordered manifest including Sanskrit, IAST, translation text/row, and voice. Each format has an independent template version. Live chapter mismatch produces `superseded` + skip; explicit backfill creates the replacement. Upload-phase chapter failures are excluded from the render retry queue.

Stale lease sweep uses one hour for Shorts and four hours for chapters; missing/invalid leases are also stale. It returns work to `failed` while preserving render/upload phase. Retry reset routes upload failures to `approved` and other failures to `pending`. The uploader selects approved rows only; generic upload failures need explicit reset before upload retry. Render retries stop after three; chapter TTS has two attempts. No heartbeat renews leases.

Uploads are multipart, with one fresh-stream retry for chapter network failures, and cannot guarantee exactly-once insertion after ambiguous responses. Review Studio before replaying. Supersede sweep can make old videos private after 30 days; it does not confirm replacement visibility and has no dedicated cron at this baseline.

## Configuration, fonts, and credentials

`config.ts` validates YAML styles, eligibility, review floors, voices, and pacing. Shorts require each text's `reviewed` floor; chapters permit configured `draft`. A media auto-approval does not promote corpus review status. `tts-request.ts` sends plain translation text to Google TTS as MP3; no Sanskrit chant or baseline SSML phoneme path. Audio uses data URLs for Chromium. `youtube/composition/fonts.ts` registers checked-in Latin/Indic WOFF2 faces before rendering.

`secrets.ts` centralizes Google TTS, R2/AWS, and single-channel YouTube authorization. Production/CI fails on missing required credentials except in mock mode. OAuth bootstrap requests `youtube.upload`, `yt-analytics.readonly`, and `youtube.force-ssl`. Verify actual consent-app mode/token expiry in the console; historical rotation dates do not establish current credentials. See [handbook setup](../../scripts/youtube/README.md#oauth-setup-3-scope-union) and `.env.example`.

**Mock distinction:** production-engine `MOCK_ALL=true` creates padded WAV byte blobs under MP4 names and assumed probe metrics. It tests orchestration, not real media. Separate sample scripts run real Remotion/Chromium with silent audio and produce decodable local MP4s.

## Schedules and analytics

Configured UTC schedules: Shorts `23 */6 * * *`, chapters `0 3,15 * * *`, analytics `0 5 * * *`, digest `13 11 * * *`, lease sweep `27 * * * *`. Upload is manual-only while its schedule is paused. Check Actions run history separately before asserting successful scheduled operation.

`analytics-map.ts` fills view count, mean seconds watched per view (`watch_time_s`), average-view-percentage as a fraction (`completion_rate`), and subscribers gained. CTR/3-second retention/50% retention/UTM clicks/audio language remain NULL when unmeasured. Site-side link attribution and Studio-only metrics need separate evidence. Status JSON includes per-format counts; failure workflows create issues and the digest supports optional Slack delivery.

## Verification entry points

Use `bun run youtube:validate-config`, the [safe local walkthrough](../../docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md#how-to-inspect-without-external-side-effects), and `bun run youtube:test` / `bun run youtube:integration`. The latter wrappers isolate files into separate Bun/Vitest processes. Unit/integration fixtures establish contracts; public video provenance requires a real provider ID linked to lifecycle/input/template/artifact records.
