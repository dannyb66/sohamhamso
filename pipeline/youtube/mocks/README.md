# YouTube pipeline mock layer

**Reference · `origin/main` (`4c94bf2`), checked 2026-10-12.** `MOCK_ALL=true` replaces external TTS, R2, YouTube insertion, and analytics calls with local fixtures. It can still write local files and lifecycle database rows. It is not interchangeable with `--dry-run`.

There are two different rendering paths:

| Path | What is actually verified |
| --- | --- |
| Production render engines (`render-engine.ts`, `chapter-render-engine.ts`) in mock mode | Padded silent WAV byte blobs under `.mp4` names; assumed duration/loudness/codec metrics. Tests exercise status, filenames, hashes, sidecars, and errors without Remotion/Chromium. They do not produce playable MP4 or verify real media QA. |
| Sample scripts (`youtube-render-sample.ts`, `youtube-render-chapter-samples.ts`) in mock mode | Actual Remotion/Chromium render with silent audio; decodable H.264/AAC video for visual inspection. Silent audio is not a passing production loudness result. No R2 or lifecycle-state writes. |

## How to produce a real local visual sample

After [root onboarding](../../../README.md#run-locally), run:

```bash
MOCK_ALL=true bun scripts/youtube-render-chapter-samples.ts \
  --text-slug=siva-sutras --chapter=1 --limit=1 --out=samples-chapters-doc-preview
```

This writes a one-verse landscape MP4 and `.timing.json` beneath the repository. `--out` is joined beneath the current working directory; use a relative path. Dependencies must be installed, fonts must be readable, and the first run may download Chrome Headless Shell. The historical time-to-first-artifact target of ten minutes is not a measured guarantee.

To preview the job without rendering or downloading Chromium:

```bash
bun scripts/youtube-render-chapter-samples.ts \
  --dry-run --json --text-slug=siva-sutras --chapter=1 --limit=1
```

A speech-only mock writes WAV fixtures, not video:

```bash
MOCK_ALL=true bun scripts/youtube-tts-smoke.ts
```

For lifecycle exercises, first set `YOUTUBE_DB_PATH` to a disposable state database. Without that override, scripts may write video state into the local corpus database. See the [isolated walkthrough](../../../docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md#how-to-inspect-without-external-side-effects).

## Substitutions

| Integration | Mock behavior |
| --- | --- |
| Google TTS | `cannedSilentWav(seconds)`, valid silent PCM bytes |
| Production Remotion render | Padded byte fixture and assumed probe metrics |
| R2 put | Copy file beneath local work directory |
| YouTube insertion | Synthetic video ID; local lifecycle state can still change |
| Chapter upload sidecar | Canned timestamps exercise metadata construction |
| Analytics API | Canned response through the real mapper/upsert |
| Secret resolver | Empty placeholders rather than production credential failure |

`cannedImagePng()` is an exported fixture utility, not an AI-generated background or proof that the production renderer exercises an image pipeline. The baseline compositions render text on configured colors.

## Fixture exports

```ts
import { cannedSilentWav, cannedImagePng } from './canned';

cannedSilentWav(seconds = 1); // Buffer: valid 16-bit mono 44.1 kHz WAV
cannedImagePng();             // Buffer: valid 1×1 RGBA PNG
```

The WAV has a 44-byte header plus zero-filled sample bytes. The PNG is a fixed base64 fixture. Neither requires network access or credentials. The test harness uses these fixtures to isolate orchestration; use real samples and provider-backed evaluation for media/speech conclusions.

See [CLI conventions](../CLI-CONVENTIONS.md), [operator handbook](../../../scripts/youtube/README.md), and the [platform reference](../../../docs/AI-VIDEO-AND-YOUTUBE-PLATFORM.md).
