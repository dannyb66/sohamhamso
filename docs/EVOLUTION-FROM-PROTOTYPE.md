# Evolution from the prototype

The older [soham-hamso repository](https://github.com/dannyb66/soham-hamso) explores audio-to-lyric-video generation. The current project builds reusable corpus, translation, web and media infrastructure. This comparison is based on code and recorded history, inspected **2026-10-12**, not on inferred production success.

## Historical baseline

Prototype commit `f4777a534e5007df3cc5e597306762577078c6c0` dated 2025-06-14 is the last local committed version inspected. It is ahead of the remote main tip `db8482a9ced676351a3f41117b8e87ddf3315750`, verified with `git ls-remote` on 2026-10-12; its GitHub commit URLs returned 404, so the comparison uses the local object rather than claiming public availability. Its `main.py` accepts MP3 or MP4, extracts audio when needed, runs Whisper `medium` with language `sa`, caches transcription segments, translates each segment using GPT-4 and composes centered Sanskrit/English text over black with MoviePy. The default entry point hardcodes `chant.mp3` to `lyric_video.mp4`, 720×480, 24 fps.

The cache is keyed by a neighboring filename, not by audio hash plus model/prompt identity. Translation failures produce “Translation unavailable” and continue. Temporary extracted audio is removed at interpreter exit. The script has no corpus identity, licensed-source schema, review-state contract, durable job lease, rendering QA, upload worker or analytics loop.

Recorded commit subjects explicitly say “v1 not working, to be fixed,” “openai version bugs exists still not working,” and “returning basic output but not working.” These are author-recorded limitations, not a measured diagnosis of all later runs. No clean-room successful execution of this prototype was performed during documentation work.

## Local experimentation is separate evidence

The prototype working directory has uncommitted changes to `main.py` and `requirements.txt`, deleted tracked transcript/video artifacts, and a temporary audio file. Its local script replaces Whisper with Fairseq/Wav2Vec2, loads a machine-specific checkpoint, distributes detected words evenly across total audio duration, calls GPT-4o-mini, and retains MoviePy composition. Even distribution is an approximation rather than forced audio alignment. These local changes are not the committed prototype and were neither executed nor edited for this task.

This distinction matters: a description combining committed Whisper, uncommitted Fairseq and the current Remotion pipeline would imply an integrated architecture that the repositories do not contain.

## Architectural improvements evidenced in the current baseline

| Earlier limitation | Current mechanism | Evidence | Remaining limit |
|---|---|---|---|
| Text identity comes from ASR output | Corpus addresses and typed Sanskrit/source records | [schema](../src/lib/seo/corpus-schema.ts), [ingest](../pipeline/ingest/ingest.ts) | Editorial correctness and source rights need separate review |
| Translation prompt has no structured provenance | Versioned grounding/judge prompts, model and permanent AI fields | [runner](../pipeline/translate/runner.ts), [status contract](../STATUS-CONTRACT.md) | Recorded model labels and API identifier differ; most checked-in translations have no judge score |
| One serial script owns everything | Translation, ingestion, web, dataset, render and upload modules | [architecture](ARCHITECTURE.md) | Operational handoffs still need reconciliation |
| One caption style and English only | Twelve reader locales, Indic fonts, separate short/chapter compositions | [reading modes](../src/lib/reading-modes.ts), [compositions](../youtube/composition/Root.tsx) | Baseline chapter generation is English-only |
| No durable publishing state | SQL states/events, leases, retries, supersession | [video schema](../db/schema.sql), [video platform](AI-VIDEO-AND-YOUTUBE-PLATFORM.md) | External upload and state commit are not one atomic transaction |
| No reproducible dataset | Versioned export formats, source exclusions, SHA-256 | [publisher](../pipeline/dataset/publish.ts) | Export permission flags do not establish license clearance |
| No delivery/runtime separation | Native build DB, asynchronous edge DB, static indexes and SSR reader | [decision 001](decisions/001-static-versus-ssr.md), [decision 002](decisions/002-database-boundaries.md) | Remote DB quota and outage remain runtime dependencies |

These mechanisms support a stronger engineering story because they are inspectable and tested. They do not demonstrate a latency or cost improvement without a comparable measurement.

## Current branch evolution

The [capability matrix](CAPABILITY-MATRIX.md) records commit identity and merge status. Highlights:

- `origin/main` includes chapter rendering, SEO/analytics tooling, OG JSON caching, materialized lemma lookup and a manual-only upload workflow.
- `feat/youtube-chapter-language-routing` at `8aa582f` introduces per-language channel routing and Azure voice support. It is outside the selected merged baseline.
- `worktree-feat-pdf-books` at `5b74dac` assembles corpus content into HTML, prints using Chromium, hashes PDFs, and writes an R2 download manifest for `/library`. That branch is not merged; the public `/library` probe returned 404 on inspection.
- The primary local worktree contains uncommitted static-corpus/D1, subscriber-mail, Node-adapter/Docker and Rudri work. A sibling Rudra worktree contains external-audio composition experiments. These were read as evidence and preserved.

## Parallel Rudri and source-audio direction

The uncommitted Rudri implementation combines rights-attested source video/audio, bounded ASR/OCR windows, overlap and persisted jobs, reviewed seed timing, deterministic ASS captions and FFmpeg parts. Parts are probed and assembled in order; continuous source audio is muxed once. This differs from creating narration using the merged TTS renderer. The local design also introduces review gates for disagreements and missing translation fields.

No measured performance gain for parallel rendering was reproduced here. No assertion that its background PNGs were generated by an image model is supported by their filenames alone. See [video platform](AI-VIDEO-AND-YOUTUBE-PLATFORM.md) for the status and exact limitations.

## Public artifacts and attribution

The [SOHAM HAMSO channel](https://www.youtube.com/@sohamhamso) lists [Tripura Rahasya, Chapter 1](https://www.youtube.com/watch?v=BpMYhZOb5VE) and [Shiva Shadakshara Stotram with English meanings](https://www.youtube.com/watch?v=fuo18Q8Y9gA). Both IDs/titles were observed in the public channel listing on 2026-10-12. They demonstrate the channel's scripture/audio/translation output style. There is no committed manifest or state row connecting either ID to a particular renderer, so they are not attributed to the present pipeline or prototype.

Audio performer and recording credits do not by themselves grant reuse rights. Public channel visibility is not proof of source licensing. Source and media attribution are covered in [security and provenance](SECURITY-PROVENANCE-AND-LICENSES.md).

## How to use this history

In an interview, explain the change from a script tied to one input file to a reusable data contract serving several consumers. Show a current test or source reference for every claimed improvement. Say which reliability problems remain, how you would measure them, and which work is branch-only. Do not call this an enterprise-scale migration, a trained model platform or cross-team leadership program without evidence beyond these repositories.
