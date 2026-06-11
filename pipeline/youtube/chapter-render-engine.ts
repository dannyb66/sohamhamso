/**
 * pipeline/youtube/chapter-render-engine.ts
 *
 * `renderChapterOne(db, video, opts)` — the per-video orchestration for the
 * chapter format (16:9 full-chapter videos, `videos.format='chapter'`,
 * verse_num=0). The chapter sibling of `render-engine.ts::renderOne`,
 * reusing its exported helpers (synthesize, probeAudioDurationS, probeMp4,
 * reencodeHighBitrate, uploadR2, audioFileToDataUrl) and its MOCK_ALL
 * discipline:
 *
 *   resolve ALL verses+translations for (text_id, chapter, lang)
 *     → build manifest → verify stored md5 vs chapterContentMd5(manifest)
 *       (mismatch → markSuperseded + skip — NEVER the failed/retry loop)
 *     → per-verse TTS (retry 2× w/ backoff; failures name the verse)
 *       + title-card narration TTS
 *     → probe durations → buildChapterProps (per-segment data-URL audio)
 *     → bundle ONCE per process (serveUrl cached for batch reuse)
 *     → renderMedia 'Chapter' → re-encode per cfg.chapters.encode
 *     → probeMp4 → qaChecks(CHAPTER_LIMITS + ±2s duration consistency)
 *     → upload mp4 + `.meta.json` sidecar to R2 (ATOMIC PAIR)
 *     → updateVideoStatus approved
 *
 * Also `renderChapterAudioOnly(db, …)` — the `--audio-only` mode for the
 * multi-audio-track test: rebuilds the manifest for a TARGET lang, TTSes
 * each verse, PCM-pads each segment to the EXISTING sidecar's timing, and
 * encodes one aligned m4a/mp3. No DB/R2 mutation.
 *
 * Heavy/optional deps (@remotion/*, @google-cloud/text-to-speech, ffmpeg)
 * stay behind dynamic import + MOCK_ALL guards so THIS MODULE IMPORTS
 * CLEANLY with none of them installed (unit tests + zero-secret D1 path).
 */
import type { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '../../src/lib/db';
import { type VideoRow, markSuperseded, updateVideoStatus } from '../../src/lib/videos-db';
import type { ChapterProps } from '../../youtube/composition/types';
import { translationFontForLang } from '../../youtube/composition/types';
import { buildChapterProps } from './chapter-props';
import {
  type ChaptersConfig,
  type YoutubeConfig,
  getChaptersConfig,
  getStylePreset,
  loadYoutubeConfig,
} from './config';
import { type ChapterManifestEntry, chapterContentMd5, translationMd5 } from './determinism';
import { STATUS_ORDER } from './eligibility';
import { buildChapterR2Key, chapterMetaKey } from './filename';
import { log, scrubError } from './log';
import { cannedSilentWav } from './mocks/canned';
import { CHAPTER_LIMITS, type QaResult, qaChecks } from './qa';
import {
  type RenderOpts,
  type RenderResult,
  audioFileToDataUrl,
  md5File,
  probeAudioDurationS,
  probeMp4,
  reencodeHighBitrate,
  sha256File,
  synthesize,
  uploadR2,
} from './render-engine';
import { getR2Creds } from './secrets';

const STAGE = 'render';

/** MOCK_ALL canned-WAV narration length, seconds (mirrors renderOne). */
const MOCK_NARRATION_S = 2;
/** TTS per-verse retry budget: 1 try + 2 retries, with backoff. */
const TTS_RETRIES = 2;
const TTS_BACKOFF_MS = [1_000, 3_000];

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Lang helpers (mirror render-engine.ts::resolveContent)
// ─────────────────────────────────────────────────────────────────────────────

/** Verse lang → Google TTS BCP-47 code (en→en-US, Indic langs → <lang>-IN). */
export function ttsLangCode(lang: string): string {
  return lang === 'en' ? 'en-US' : `${lang}-IN`;
}

/** Human label for the lang (ChapterProps.langLabel). */
const LANG_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'हिन्दी',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  kn: 'ಕನ್ನಡ',
  ml: 'മലയാളം',
  bn: 'বাংলা',
  mr: 'मराठी',
  gu: 'ગુજરાતી',
  pa: 'ਪੰਜਾਬੀ',
  or: 'ଓଡ଼ିଆ',
  as: 'অসমীয়া',
};
export function langLabelFor(lang: string): string {
  return LANG_LABELS[lang] ?? lang;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifest resolution (shared by the engine AND youtube-backfill-chapters)
// ─────────────────────────────────────────────────────────────────────────────

/** One resolved verse: manifest entry + sidecar provenance fields. */
export interface ChapterVerseResolved extends ChapterManifestEntry {
  /** md5 of THIS verse's translation text (sidecar provenance). */
  translation_md5: string;
}

export interface ChapterResolveResult {
  /** Manifest entries sorted by verse_num — input to chapterContentMd5. */
  manifest: ChapterManifestEntry[];
  /** Same rows, with per-verse translation_md5 for the sidecar. */
  verses: ChapterVerseResolved[];
  /** Verse refs ("<text> <ch>.<v>") lacking a usable translation. */
  missing: string[];
}

/**
 * Resolve every verse of (text_id, chapter) with its best `lang`
 * translation: explicit status-priority CASE ordering
 * (published → reviewed → draft — NOT alphabetical), floored at
 * `floor` (cfg.chapters.min_translation_status), non-empty text required.
 * Verses with no qualifying translation land in `missing`.
 */
export function resolveChapterVerses(
  corpus: Database,
  textId: string,
  chapter: number,
  lang: string,
  floor: string,
  ttsVoiceId: string,
): ChapterResolveResult {
  const floorRank = STATUS_ORDER[floor as keyof typeof STATUS_ORDER] ?? STATUS_ORDER.reviewed;
  const rows = corpus
    .query<
      {
        verse_num: number;
        devanagari: string;
        iast: string | null;
        translation_row_id: number | null;
        translation_text: string | null;
      },
      [string, string, number, number]
    >(
      `SELECT v.verse_num, v.devanagari, v.iast,
              t.id AS translation_row_id, t.translation_text
         FROM verses v
         LEFT JOIN translations t ON t.id = (
           SELECT t2.id FROM translations t2
            WHERE t2.verse_id = v.id
              AND t2.lang = ?2
              AND TRIM(t2.translation_text) <> ''
              AND (CASE t2.status
                     WHEN 'draft' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'published' THEN 2
                     ELSE -1 END) >= ?3
            ORDER BY t2.ai_assisted ASC,
                     CASE t2.status
                       WHEN 'published' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'draft' THEN 2
                       ELSE 3 END ASC,
                     t2.created_at ASC, t2.id ASC
            LIMIT 1)
        WHERE v.text_id = ?1 AND v.chapter = ?4
        ORDER BY v.verse_num ASC`,
    )
    .all(textId, lang, floorRank, chapter);

  const manifest: ChapterManifestEntry[] = [];
  const verses: ChapterVerseResolved[] = [];
  const missing: string[] = [];
  for (const r of rows) {
    if (r.translation_row_id == null || !r.translation_text || r.translation_text.trim() === '') {
      missing.push(`${textId} ${chapter}.${r.verse_num} (${lang})`);
      continue;
    }
    const entry: ChapterManifestEntry = {
      verse_num: r.verse_num,
      devanagari: r.devanagari,
      iast: r.iast ?? '',
      translation_text: r.translation_text,
      translation_row_id: r.translation_row_id,
      tts_voice_id: ttsVoiceId,
    };
    manifest.push(entry);
    verses.push({ ...entry, translation_md5: translationMd5(r.translation_text) });
  }
  return { manifest, verses, missing };
}

/** Title-card narration line ("The Śiva Sūtras of Vasugupta. Chapter 1."). */
export function buildTitleNarration(
  textTitle: string,
  author: string | null | undefined,
  chapter: number,
): string {
  const of = author && author.trim() !== '' ? ` of ${author.trim()}` : '';
  return `The ${textTitle}${of}. Chapter ${chapter}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidecar (.meta.json) — the contract Agent F's uploader consumes
// ─────────────────────────────────────────────────────────────────────────────

export interface ChapterSidecarSegment {
  verse_num: number;
  startS: number;
  durationS: number;
  translation_row_id: number;
  translation_md5: string;
}

export interface ChapterSidecar {
  segments: ChapterSidecarSegment[];
  durationS: number;
  verseCount: number;
  lang: string;
  voiceId: string;
  templateVersion: string;
  manifestMd5: string;
  /** Start of the outro card in seconds — the uploader's final timestamp line. */
  outroStartS: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS with retry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `synthesize` with 2 retries + backoff. A final failure throws an error
 * NAMING the verse/label so `last_error` is actionable at 2am.
 */
async function synthesizeWithRetry(
  text: string,
  voiceId: string,
  langCode: string,
  outPath: string,
  label: string,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= TTS_RETRIES; attempt++) {
    try {
      await synthesize(text, voiceId, langCode, outPath);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < TTS_RETRIES) await sleep(TTS_BACKOFF_MS[attempt] ?? 3_000);
    }
  }
  throw new Error(
    `TTS failed for ${label} after ${TTS_RETRIES + 1} attempts: ${scrubError(lastErr)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Remotion bundle — ONCE per process (batch reuse: per-segment audio rides in
// inputProps as data URLs, so the bundle has no per-video static assets)
// ─────────────────────────────────────────────────────────────────────────────

let _serveUrlPromise: Promise<string> | null = null;

async function getServeUrlCached(): Promise<string> {
  if (!_serveUrlPromise) {
    _serveUrlPromise = (async () => {
      const bundleMod = await import('@remotion/bundler' as string).catch((e) => {
        throw new Error(`@remotion/bundler not installed: ${scrubError(e)}`);
      });
      // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
      const bundle = (bundleMod as any).bundle;
      // entry.ts calls registerRoot() (required by @remotion/bundler).
      const entry = join(process.cwd(), 'youtube', 'composition', 'entry.ts');
      return bundle({ entryPoint: entry });
    })();
    // A failed bundle must not poison the cache for the rest of the batch.
    _serveUrlPromise.catch(() => {
      _serveUrlPromise = null;
    });
  }
  return _serveUrlPromise;
}

/** Test hook — drop the cached serveUrl. */
export function __resetServeUrlCacheForTests(): void {
  _serveUrlPromise = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Encode variants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CRF-18 re-encode (chapter `encode: crf18` config option): visually
 * transparent quality at a fraction of CBR-8M's file size for long static-
 * text videos (~1 GB → ~150–300 MB for siva-sutras ch3), capped at 8 Mbps
 * (`-maxrate 8M -bufsize 16M`) so YouTube still reads an HD-grade source.
 * Lives HERE (chapter-only) — render-engine.ts keeps only the shorts CBR
 * path. Consumes `src`.
 */
export async function reencodeCrf18(src: string, dst: string): Promise<void> {
  const ffmpegMod = await import('ffmpeg-static' as string).catch((e) => {
    throw new Error(`ffmpeg-static not installed: ${scrubError(e)}`);
  });
  const ffmpeg = (ffmpegMod as { default?: string }).default;
  if (!ffmpeg) throw new Error('ffmpeg-static resolved no binary path');
  const proc = Bun.spawn(
    [
      ffmpeg,
      '-y',
      '-i',
      src,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-maxrate',
      '8M',
      '-bufsize',
      '16M',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      dst,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg crf18 re-encode failed (${code}): ${scrubError(err)}`);
  }
  rmSync(src, { force: true });
}

/**
 * Render the Chapter composition to MP4 + re-encode per `encode` mode.
 * MOCK_ALL → canned bytes padded past the chapter 5MB QA gate so the QA +
 * upload paths run with no remotion installed (mirrors renderOne).
 */
async function renderChapterMp4(
  props: ChapterProps,
  outPath: string,
  encode: ChaptersConfig['encode'],
): Promise<void> {
  if (isMockAll()) {
    const wav = cannedSilentWav(3);
    const pad = Buffer.alloc(Math.max(0, 5_200_000 - wav.length));
    writeFileSync(outPath, Buffer.concat([wav, pad]));
    return;
  }
  const rendererMod = await import('@remotion/renderer' as string).catch((e) => {
    throw new Error(`@remotion/renderer not installed: ${scrubError(e)}`);
  });
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
  const { selectComposition, renderMedia } = rendererMod as any;
  const serveUrl = await getServeUrlCached();
  const composition = await selectComposition({
    serveUrl,
    id: 'Chapter',
    inputProps: props,
  });
  const rawPath = `${outPath}.raw.mp4`;
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: rawPath,
    inputProps: props,
    chromiumOptions: { ignoreCertificateErrors: false },
    timeoutInMilliseconds: 120_000, // headroom: fonts + many data-URL <Audio>
    jpegQuality: 100,
  });
  if (encode === 'crf18') await reencodeCrf18(rawPath, outPath);
  else await reencodeHighBitrate(rawPath, outPath);
}

// ─────────────────────────────────────────────────────────────────────────────
// renderChapterOne
// ─────────────────────────────────────────────────────────────────────────────

export interface ChapterRenderOpts extends RenderOpts {
  /** Skip workdir cleanup + print its path (failure-repro debugging). */
  keepWorkDir?: boolean;
}

interface TextRow {
  slug: string;
  title_iast: string | null;
  title_en: string;
  title_sa: string;
  author: string | null;
  tradition: string;
}

/**
 * Render one CHAPTER video end-to-end. Mutates `db` (videos DB) status on
 * completion. Never throws for a per-video failure (marks the row failed +
 * returns status:'failed'). An md5 mismatch against the live corpus is NOT
 * a failure: the row is superseded + skipped (the next backfill dispatch
 * inserts the fresh row) — never the 3×90-min retry loop.
 */
export async function renderChapterOne(
  db: Database,
  video: VideoRow,
  opts: ChapterRenderOpts = {},
): Promise<RenderResult> {
  const cfg = opts.cfg ?? loadYoutubeConfig();
  const chapters = getChaptersConfig(cfg);

  if (opts.dryRun) {
    return { videoId: video.id, status: 'skipped' };
  }

  const ownWorkDir = opts.workDir === undefined;
  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), 'yt-chapter-'));
  if (isMockAll()) mkdirSync(join(workDir, 'r2'), { recursive: true });

  try {
    const preset = getStylePreset(cfg, video.style_preset);
    const corpus = getDb();
    const text = corpus
      .query<TextRow, [string]>(
        'SELECT slug, title_iast, title_en, title_sa, author, tradition FROM texts WHERE id = ? LIMIT 1',
      )
      .get(video.text_id);
    if (!text) throw new Error(`text missing for ${video.text_id}`);
    const textTitle = text.title_iast || text.title_en || video.text_id;

    // 1. Resolve all verses + translations (status-priority + floor).
    const resolved = resolveChapterVerses(
      corpus,
      video.text_id,
      video.chapter,
      video.lang,
      chapters.min_translation_status,
      video.tts_voice_id,
    );
    if (resolved.manifest.length === 0) {
      throw new Error(`no verses found for ${video.text_id} chapter ${video.chapter}`);
    }
    if (resolved.missing.length > 0) {
      throw new Error(`missing/empty translation for: ${resolved.missing.join(', ')}`);
    }

    // 2. Determinism gate: stored hash vs live-corpus manifest hash.
    //    MISMATCH = the corpus moved since backfill → supersede + skip.
    //    NEVER the failed/retry path (re-rendering stale content 3× at
    //    90 min/run buys nothing; the next backfill inserts the fresh row).
    const manifestMd5 = chapterContentMd5(resolved.manifest);
    if (manifestMd5 !== video.translation_md5) {
      log(
        STAGE,
        'CHAPTER MD5 MISMATCH — corpus changed since backfill; superseding (NOT failing)',
        {
          video: video.id,
          stored: video.translation_md5,
          live: manifestMd5,
          next: 'dispatch youtube-backfill-chapters to insert the fresh row',
        },
      );
      markSuperseded(db, video.id, 'manual');
      return { videoId: video.id, status: 'skipped' };
    }

    // 3. Per-verse TTS + title-card narration (retry 2×; names the verse).
    const langCode = ttsLangCode(video.lang);
    const titleText = buildTitleNarration(textTitle, text.author, video.chapter);
    const titlePath = join(workDir, `${video.id}.title.mp3`);
    await synthesizeWithRetry(
      titleText,
      video.tts_voice_id,
      langCode,
      titlePath,
      `${video.text_id} ch${video.chapter} title card`,
    );

    const versePaths: string[] = [];
    for (const v of resolved.verses) {
      const p = join(workDir, `${video.id}.v${v.verse_num}.mp3`);
      const t0 = Date.now();
      await synthesizeWithRetry(
        v.translation_text,
        video.tts_voice_id,
        langCode,
        p,
        `${video.text_id} ${video.chapter}.${v.verse_num} (${video.lang})`,
      );
      versePaths.push(p);
      log(STAGE, 'tts ok', {
        verse: `${video.chapter}.${v.verse_num}`,
        ms: Date.now() - t0,
      });
    }

    // 4. Probe narration durations (MOCK_ALL canned wav = 2s, as renderOne).
    const titleNarrationS = isMockAll() ? MOCK_NARRATION_S : await probeAudioDurationS(titlePath);
    const narrationDurations: number[] = [];
    for (const p of versePaths) {
      narrationDurations.push(isMockAll() ? MOCK_NARRATION_S : await probeAudioDurationS(p));
    }

    // 5. Props: per-segment base64 data-URL <Audio> (the Short.tsx pattern —
    //    renderMedia only fetches http(s)/staticFile/data URLs).
    const props = buildChapterProps({
      textTitle,
      textTitleDevanagari: text.title_sa,
      chapter: video.chapter,
      chapterName: null,
      lang: video.lang,
      langLabel: langLabelFor(video.lang),
      preset,
      translationFont: translationFontForLang(video.lang),
      outroUrl: `sohamhamso.org/${text.tradition}/${text.slug}/${video.chapter}`,
      verses: resolved.verses.map((v, i) => ({
        verseNum: v.verse_num,
        devanagari: v.devanagari,
        iast: v.iast,
        translation: v.translation_text,
        audioSrc: audioFileToDataUrl(versePaths[i]),
        narrationDurationS: narrationDurations[i],
      })),
      titleCardAudioSrc: audioFileToDataUrl(titlePath),
      titleNarrationS,
      fps: chapters.fps,
      titleCardS: chapters.title_card_s,
      outroS: chapters.outro_s,
      minSegS: chapters.min_seg_s,
      segLeadInS: chapters.seg_lead_in_s,
      segTailS: chapters.seg_tail_s,
    });
    const fps = props.fps;
    const expectedDurationS = props.durationInFrames / fps;

    // 6. Render + encode.
    const mp4Path = join(workDir, `${video.id}.mp4`);
    await renderChapterMp4(props, mp4Path, chapters.encode);

    const bytes = readFileSync(mp4Path).length;
    const sha256 = sha256File(mp4Path);
    const localMd5 = md5File(mp4Path);

    // 7. Probe the ACTUAL file (MOCK_ALL keeps assumed metrics, as renderOne).
    let durationS = expectedDurationS;
    let loudnessLufs = -20;
    let codecVideo = 'h264';
    let codecAudio = 'aac';
    if (!isMockAll()) {
      const probe = await probeMp4(mp4Path);
      durationS = probe.durationS;
      loudnessLufs = probe.loudnessLufs;
      codecVideo = probe.codecVideo;
      codecAudio = probe.codecAudio;
    }

    // 8. QA: chapter limits — no duration window, ±2s consistency instead.
    const qa: QaResult = qaChecks(
      {
        bytes,
        durationS,
        loudnessLufs,
        codecVideo,
        codecAudio,
        etag: localMd5,
        localMd5,
        expectedDurationS,
      },
      CHAPTER_LIMITS,
    );

    const ident = { text_id: video.text_id, chapter: video.chapter, lang: video.lang };
    const r2Key = buildChapterR2Key(ident, video.translation_md5);
    const metaR2Key = chapterMetaKey(ident, video.translation_md5);

    if (!qa.pass) {
      updateVideoStatus(db, video.id, 'failed', {
        last_error: scrubError(`QA failed: ${qa.failures.join('; ')}`),
        last_error_phase: 'probe',
        output_bytes: bytes,
        output_file_sha256: sha256,
        retry_count: (video.retry_count ?? 0) + 1,
      });
      log(STAGE, 'QA failed', { video: video.id, failures: qa.failures.length });
      return { videoId: video.id, status: 'failed', qa, sha256, bytes, durationS };
    }

    // 9. Upload mp4 + sidecar as an ATOMIC PAIR: if the sidecar put fails,
    //    the row goes failed (outer catch) — never approved without its
    //    timestamps/provenance. Re-running re-puts both (same keys, safe).
    const sidecar: ChapterSidecar = {
      segments: resolved.verses.map((v, i) => ({
        verse_num: v.verse_num,
        startS: props.segments[i].startFrame / fps,
        durationS: props.segments[i].durationInFrames / fps,
        translation_row_id: v.translation_row_id,
        translation_md5: v.translation_md5,
      })),
      durationS: expectedDurationS,
      verseCount: resolved.verses.length,
      lang: video.lang,
      voiceId: video.tts_voice_id,
      templateVersion: video.template_version,
      manifestMd5,
      outroStartS: (props.durationInFrames - props.outroFrames) / fps,
    };
    await uploadR2(mp4Path, r2Key, workDir);
    const metaPath = join(workDir, `${video.id}.meta.json`);
    writeFileSync(metaPath, JSON.stringify(sidecar, null, 2));
    try {
      await uploadR2(metaPath, metaR2Key, workDir);
    } catch (e) {
      throw new Error(
        `sidecar upload failed (atomic pair — row stays unapproved): ${scrubError(e)}`,
      );
    }

    updateVideoStatus(db, video.id, 'approved', {
      r2_key: r2Key,
      output_bytes: bytes,
      output_file_sha256: sha256,
      duration_s: durationS,
      rendered_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      approved_by: 'auto-qa',
    });
    log(STAGE, 'approved', {
      video: video.id,
      chapter: `${video.text_id} ch${video.chapter}`,
      verses: sidecar.verseCount,
      bytes,
      r2: r2Key,
    });
    return { videoId: video.id, status: 'approved', qa, r2Key, sha256, bytes, durationS };
  } catch (e) {
    const msg = scrubError(e);
    updateVideoStatus(db, video.id, 'failed', {
      last_error: msg,
      last_error_phase: 'render',
      retry_count: (video.retry_count ?? 0) + 1,
    });
    log(STAGE, 'chapter render failed', { video: video.id });
    return { videoId: video.id, status: 'failed', error: msg };
  } finally {
    if (opts.keepWorkDir) {
      log(STAGE, 'workdir kept', { video: video.id, path: workDir });
    } else if (ownWorkDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// --audio-only mode (multi-audio-track test): aligned narration track only
// ─────────────────────────────────────────────────────────────────────────────

/** Maps to exit code 3 (config/gate) in scripts/youtube-render-chapters.ts. */
export class ChapterAudioOnlyError extends Error {
  readonly exitCode = 3;
}

export interface AudioOnlyOpts {
  videoId: number;
  /** TARGET lang for the track (e.g. 'hi') — not necessarily the row's lang. */
  lang: string;
  outPath: string;
  /** Local sidecar path override (else downloaded from R2 via the row's key). */
  sidecarPath?: string;
  cfg?: YoutubeConfig;
  workDir?: string;
}

export interface AudioOnlyResult {
  videoId: number;
  lang: string;
  outPath: string;
  durationS: number;
  verseCount: number;
}

const AUDIO_SR = 48_000; // samples/s, s16le mono

/** Download an R2 object to a local path (`aws s3 cp`, real path only). */
async function downloadR2(key: string, destPath: string): Promise<void> {
  const r2 = getR2Creds();
  const proc = Bun.spawn(
    ['aws', 's3', 'cp', `s3://${r2.bucket}/${key}`, destPath, '--endpoint-url', r2.endpoint],
    {
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: r2.accessKeyId,
        AWS_SECRET_ACCESS_KEY: r2.secretAccessKey,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`aws s3 cp (download) failed (${code}): ${scrubError(err)}`);
  }
}

/** Decode any audio file to raw s16le mono 48k PCM bytes via ffmpeg-static. */
async function decodeToPcm(srcPath: string, workDir: string): Promise<Buffer> {
  const ffmpegMod = await import('ffmpeg-static' as string).catch((e) => {
    throw new Error(`ffmpeg-static not installed: ${scrubError(e)}`);
  });
  const ffmpeg = (ffmpegMod as { default?: string }).default;
  if (!ffmpeg) throw new Error('ffmpeg-static resolved no binary path');
  const out = join(workDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.pcm`);
  const proc = Bun.spawn(
    [
      ffmpeg,
      '-y',
      '-i',
      srcPath,
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      '-ac',
      '1',
      '-ar',
      String(AUDIO_SR),
      out,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg pcm decode failed (${code}): ${scrubError(err)}`);
  }
  const buf = readFileSync(out);
  rmSync(out, { force: true });
  return buf;
}

/** Encode raw s16le mono 48k PCM to m4a (aac) or mp3 by outPath extension. */
async function encodePcm(pcmPath: string, outPath: string): Promise<void> {
  const ffmpegMod = await import('ffmpeg-static' as string).catch((e) => {
    throw new Error(`ffmpeg-static not installed: ${scrubError(e)}`);
  });
  const ffmpeg = (ffmpegMod as { default?: string }).default;
  if (!ffmpeg) throw new Error('ffmpeg-static resolved no binary path');
  const codecArgs = outPath.endsWith('.mp3')
    ? ['-c:a', 'libmp3lame', '-b:a', '192k']
    : ['-c:a', 'aac', '-b:a', '192k'];
  const proc = Bun.spawn(
    [
      ffmpeg,
      '-y',
      '-f',
      's16le',
      '-ar',
      String(AUDIO_SR),
      '-ac',
      '1',
      '-i',
      pcmPath,
      ...codecArgs,
      outPath,
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`ffmpeg audio encode failed (${code}): ${scrubError(err)}`);
  }
}

/** Wrap s16le mono 48k PCM in a WAV container (MOCK_ALL output). */
function wavWrap(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(AUDIO_SR, 24);
  header.writeUInt32LE(AUDIO_SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Build ONE aligned narration track for a chapter row in a TARGET lang
 * (the multi-audio-track test): rebuild the manifest for `lang`, TTS each
 * verse, PCM-pad each segment to exactly the EXISTING sidecar's timing
 * (round(durationS × sampleRate) samples — i.e. round(durationInFrames ×
 * sampleRate / fps)), place narration at the configured segment lead-in,
 * concat, and encode m4a/mp3 to `outPath`.
 *
 * NO DB/R2 mutation. Throws ChapterAudioOnlyError (exit 3) when the row is
 * not a chapter row or its sidecar is missing.
 */
export async function renderChapterAudioOnly(
  db: Database,
  opts: AudioOnlyOpts,
): Promise<AudioOnlyResult> {
  const cfg = opts.cfg ?? loadYoutubeConfig();
  const chapters = getChaptersConfig(cfg);

  const row = db
    .query<VideoRow, [number]>('SELECT * FROM videos WHERE id = ? LIMIT 1')
    .get(opts.videoId);
  if (!row) throw new ChapterAudioOnlyError(`video id ${opts.videoId} not found`);
  const format = (row as VideoRow & { format?: string }).format ?? 'short';
  if (format !== 'chapter') {
    throw new ChapterAudioOnlyError(
      `video ${opts.videoId} is format='${format}', not a chapter row`,
    );
  }

  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), 'yt-chapter-audio-'));

  // Sidecar: local override, else download next to the row's mp4 key.
  let sidecarPath = opts.sidecarPath;
  if (!sidecarPath) {
    if (!row.r2_key) {
      throw new ChapterAudioOnlyError(
        `video ${opts.videoId} has no r2_key — sidecar missing (render it first)`,
      );
    }
    if (isMockAll()) {
      throw new ChapterAudioOnlyError(
        'MOCK_ALL has no R2 to download the sidecar from — pass --sidecar=path/to/meta.json',
      );
    }
    sidecarPath = join(workDir, 'sidecar.meta.json');
    const key = row.r2_key.replace(/\.mp4$/, '.meta.json');
    await downloadR2(key, sidecarPath).catch((e) => {
      throw new ChapterAudioOnlyError(`sidecar download failed for ${key}: ${scrubError(e)}`);
    });
  }
  if (!existsSync(sidecarPath)) {
    throw new ChapterAudioOnlyError(`sidecar not found at ${sidecarPath}`);
  }
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as ChapterSidecar;
  if (!Array.isArray(sidecar.segments) || typeof sidecar.durationS !== 'number') {
    throw new ChapterAudioOnlyError(`sidecar at ${sidecarPath} is not a chapter .meta.json`);
  }

  const voice = cfg.voices[opts.lang];
  if (!voice) {
    throw new ChapterAudioOnlyError(
      `lang ${opts.lang} has no voice in cfg.voices (known: ${Object.keys(cfg.voices).join(', ')})`,
    );
  }

  // Rebuild the manifest for the TARGET lang's translations.
  const corpus = getDb();
  const resolved = resolveChapterVerses(
    corpus,
    row.text_id,
    row.chapter,
    opts.lang,
    chapters.min_translation_status,
    voice.voice_id,
  );
  if (resolved.missing.length > 0) {
    throw new Error(`missing/empty ${opts.lang} translation for: ${resolved.missing.join(', ')}`);
  }
  if (resolved.verses.length !== sidecar.segments.length) {
    throw new Error(
      `verse count mismatch: corpus has ${resolved.verses.length}, sidecar has ${sidecar.segments.length} (chapter changed since render — re-render before generating audio tracks)`,
    );
  }

  // TTS each verse in the target lang.
  const langCode = ttsLangCode(opts.lang);
  const versePaths: string[] = [];
  for (const v of resolved.verses) {
    const p = join(workDir, `audio.${opts.lang}.v${v.verse_num}.mp3`);
    await synthesizeWithRetry(
      v.translation_text,
      voice.voice_id,
      langCode,
      p,
      `${row.text_id} ${row.chapter}.${v.verse_num} (${opts.lang})`,
    );
    versePaths.push(p);
  }

  // Assemble: zero-filled PCM of the FULL video length (title card + outro
  // stay silent), each verse placed at its segment start + lead-in, hard-
  // truncated to its slot so timing can never drift from the video.
  const totalSamples = Math.round(sidecar.durationS * AUDIO_SR);
  const track = Buffer.alloc(totalSamples * 2); // s16le mono
  const leadInSamples = Math.round(chapters.seg_lead_in_s * AUDIO_SR);
  for (let i = 0; i < sidecar.segments.length; i++) {
    const seg = sidecar.segments[i];
    const slotStart = Math.round(seg.startS * AUDIO_SR);
    const slotSamples = Math.round(seg.durationS * AUDIO_SR);
    const pcm = isMockAll()
      ? Buffer.alloc(Math.round(MOCK_NARRATION_S * AUDIO_SR) * 2)
      : await decodeToPcm(versePaths[i], workDir);
    const startSample = Math.min(slotStart + leadInSamples, totalSamples);
    const maxBytes =
      Math.max(0, Math.min(slotSamples - leadInSamples, totalSamples - startSample)) * 2;
    pcm.copy(track, startSample * 2, 0, Math.min(pcm.length, maxBytes));
    if (!isMockAll() && pcm.length > maxBytes) {
      log(STAGE, 'audio-only: narration truncated to segment slot', {
        verse: `${row.chapter}.${seg.verse_num}`,
        lang: opts.lang,
        overrunS: ((pcm.length - maxBytes) / 2 / AUDIO_SR).toFixed(2),
      });
    }
  }

  if (isMockAll()) {
    writeFileSync(opts.outPath, wavWrap(track));
  } else {
    const pcmPath = join(workDir, 'track.pcm');
    writeFileSync(pcmPath, track);
    await encodePcm(pcmPath, opts.outPath);
  }
  if (opts.workDir === undefined) rmSync(workDir, { recursive: true, force: true });

  log(STAGE, 'audio-only track written', {
    video: opts.videoId,
    lang: opts.lang,
    out: opts.outPath,
    durationS: sidecar.durationS,
  });
  return {
    videoId: opts.videoId,
    lang: opts.lang,
    outPath: opts.outPath,
    durationS: sidecar.durationS,
    verseCount: resolved.verses.length,
  };
}

/** MOCK_ALL R2 destination for a key (mirrors render-engine.ts::uploadR2). */
export function mockR2Path(workDir: string, key: string): string {
  return join(workDir, 'r2', key.replace(/\//g, '__'));
}
