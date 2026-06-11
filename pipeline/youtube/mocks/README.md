# YouTube Pipeline — Mock Layer (D1)

The **zero-secret path**. With `MOCK_ALL=true`, every pipeline script swaps its
external dependencies (Google Cloud TTS, YouTube Data API, R2) for canned,
in-process substitutes. A fresh contributor can produce a **real MP4** with **no
credentials**, exercising the real Remotion render, QA gates, filename builder,
and DB write paths — only the network calls are stubbed.

**TTHW target: < 10 minutes** (time to first artifact for a fresh contributor).

```bash
# Zero-secret real MP4, no Google/YouTube/R2 keys required:
MOCK_ALL=true bun scripts/youtube-render.ts --text-slug=siva-sutras --lang=en --limit=1
# or the tts smoke:
MOCK_ALL=true bun scripts/youtube-tts-smoke.ts
```

---

## What `MOCK_ALL=true` substitutes

| Real dependency | Mock | Notes |
|-----------------|------|-------|
| Google Cloud TTS (audio) | `cannedSilentWav(seconds)` | Valid 16-bit mono 44.1kHz PCM WAV of silence; muxed under the visuals so the renderer has a real audio track. |
| Rendered background / thumbnail | `cannedImagePng()` | Tiny valid 1x1 RGBA PNG; composited so the image pipeline runs for real. |
| Remotion render | **real** | Still runs — produces a genuine MP4 from the canned WAV + PNG. |
| R2 put (`AWS_*`/`R2_*`) | local temp dir write | No network; the artifact is written to a temp path. |
| YouTube `videos.insert` | fake `youtube_video_id` | No upload; DB rows still flow through the lifecycle. |
| `secrets.ts` chokepoint | no hard-fail | TTS/YouTube/R2 clients are never constructed, so missing secrets don't error. |

`--dry-run` and `MOCK_ALL` are orthogonal: `--dry-run` plans only (no work);
`MOCK_ALL` does the real work against canned inputs. See
`../CLI-CONVENTIONS.md` for the full flag spec.

---

## Exports (`canned.ts`)

```ts
import { cannedSilentWav, cannedImagePng } from "./canned";

cannedSilentWav(seconds = 1): Buffer  // complete, playable PCM WAV of silence
cannedImagePng(): Buffer              // complete, valid 1x1 RGBA PNG
```

Both build their Buffers byte-by-byte with **no dependencies** — no network, no
native modules, no zlib, no secrets. The WAV is a canonical 44-byte header plus
zero-filled PCM samples (silence); its size is exactly
`44 + sampleRate * 2 * seconds` bytes for mono 16-bit at 44.1kHz. The PNG is a
frozen base64 literal decoding to an 8-bit RGBA 1x1 pixel (validated by
`file(1)` as `PNG image data, 1 x 1, 8-bit/color RGBA`).

These functions are the substitution primitives; the scripts themselves branch
on `process.env.MOCK_ALL === "true"` (via `secrets.ts` / the render engine) to
decide whether to call the real client or the canned buffer.
