/**
 * pipeline/youtube/render-engine.ts
 *
 * `renderOne(db, video, opts)` — the per-video orchestration for Cron A:
 *
 *   resolve translation + preset
 *     → buildTtsRequest → Google TTS (real) | cannedSilentWav (MOCK_ALL)
 *     → buildShortProps → Remotion renderMedia (real) | canned mp4 (MOCK_ALL)
 *     → probe + qaChecks
 *     → upload mp4 to R2 (`aws s3 cp`) | local copy (MOCK_ALL)
 *     → updateVideoStatus rendered → approved (on QA pass)
 *
 * Heavy/optional deps (@remotion/renderer, @google-cloud/text-to-speech) are
 * behind dynamic import + MOCK_ALL guards so THIS MODULE IMPORTS CLEANLY with
 * neither remotion nor google installed (required for unit tests + the
 * zero-secret D1 path).
 */
import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '../../src/lib/db';
import { type VideoRow, markSuperseded, updateVideoStatus } from '../../src/lib/videos-db';
import { translationFontForLang } from '../../youtube/composition/types';
import { type YoutubeConfig, getStylePreset, loadYoutubeConfig } from './config';
import { translationMd5 } from './determinism';
import { buildR2Key } from './filename';
import { log, scrubError } from './log';
import { cannedSilentWav } from './mocks/canned';
import { type QaResult, qaChecks } from './qa';
import { buildShortProps } from './remotion-props';
import { getGoogleTtsCreds, getR2Creds } from './secrets';
import { buildTtsRequest } from './tts-request';

const STAGE = 'render';

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

export interface RenderOpts {
  /** Pre-loaded config (else loaded from disk). */
  cfg?: YoutubeConfig;
  /** Skip all side effects; report only. */
  dryRun?: boolean;
  /** Working dir for intermediates (default: a fresh os tmp dir). */
  workDir?: string;
}

export interface RenderResult {
  videoId: number;
  status: 'approved' | 'rendered' | 'failed' | 'skipped';
  r2Key?: string;
  sha256?: string;
  bytes?: number;
  durationS?: number;
  qa?: QaResult;
  error?: string;
}

/** sha256 hex of a file. (Exported for chapter-render-engine reuse.) */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** md5 hex of a file (R2 ETag for single-part puts). (Exported for reuse.) */
export function md5File(path: string): string {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

/**
 * Resolve the verse's devanagari/iast/translation text + the style preset.
 * Reads the corpus DB read-only.
 */
function resolveContent(
  video: VideoRow,
  cfg: YoutubeConfig,
): {
  devanagari: string;
  iast: string;
  translation: string;
  textTitle: string;
  reference: string;
  langCode: string;
} {
  const corpus = getDb();
  const verse = corpus
    .query<{ devanagari: string; iast: string | null }, [string, number, number]>(
      `SELECT devanagari, iast FROM verses
        WHERE text_id = ? AND chapter = ? AND verse_num = ? LIMIT 1`,
    )
    .get(video.text_id, video.chapter, video.verse_num);
  const tr = corpus
    .query<{ translation_text: string }, [number]>(
      'SELECT translation_text FROM translations WHERE id = ? LIMIT 1',
    )
    .get(video.translation_row_id);
  const text = corpus
    .query<{ title_iast: string | null; title_en: string }, [string]>(
      'SELECT title_iast, title_en FROM texts WHERE id = ? LIMIT 1',
    )
    .get(video.text_id);

  if (!verse || !tr) {
    throw new Error(`content missing for ${video.text_id} ${video.chapter}.${video.verse_num}`);
  }

  // Map the verse lang to a Google TTS BCP-47 language code. English is
  // en-US; the Indic langs (hi/ta/te/kn/ml/bn/mr/gu/pa/or/as) are <lang>-IN.
  const langCode = video.lang === 'en' ? 'en-US' : `${video.lang}-IN`;

  return {
    devanagari: verse.devanagari,
    iast: verse.iast ?? '',
    translation: tr.translation_text,
    textTitle: text?.title_iast || text?.title_en || video.text_id,
    reference: `${video.chapter}.${video.verse_num}`,
    langCode,
  };
}

/**
 * Synthesize narration audio. MOCK_ALL → a canned silent WAV. Real path
 * dynamically imports @google-cloud/text-to-speech (guarded so the module
 * imports without the dep). (Exported for chapter-render-engine reuse.)
 */
export async function synthesize(
  text: string,
  voiceId: string,
  langCode: string,
  outPath: string,
  speakingRate?: number,
): Promise<void> {
  const req = buildTtsRequest(text, voiceId, langCode, speakingRate);
  if (isMockAll()) {
    writeFileSync(outPath, cannedSilentWav(2));
    return;
  }
  // Resolve creds via the chokepoint (hard-fails in prod when absent).
  const creds = getGoogleTtsCreds();
  const mod = await import('@google-cloud/text-to-speech' as string).catch((e) => {
    throw new Error(`@google-cloud/text-to-speech not installed: ${scrubError(e)}`);
  });
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape (dep installed later)
  const m = mod as any;
  const TextToSpeechClient = m.TextToSpeechClient ?? m.default?.TextToSpeechClient;
  // Prefer the inline service-account JSON (GOOGLE_TTS_CREDENTIALS_JSON — what
  // the GitHub Actions crons set); the Google auth lib does NOT read that env
  // itself, so pass it explicitly. Otherwise fall back to ADC /
  // GOOGLE_APPLICATION_CREDENTIALS (local dev).
  const client = creds.credentialsJson
    ? new TextToSpeechClient({ credentials: JSON.parse(creds.credentialsJson) })
    : new TextToSpeechClient();
  const [resp] = await client.synthesizeSpeech(req);
  if (!resp?.audioContent) throw new Error('TTS returned no audioContent');
  writeFileSync(outPath, Buffer.from(resp.audioContent as Uint8Array));
}

/**
 * Render the Remotion composition to MP4. MOCK_ALL → write a tiny canned
 * file (the silent WAV bytes under an .mp4 name) so QA + upload paths run
 * without remotion installed. Real path dynamically imports @remotion/renderer.
 */
async function renderMp4(
  props: ReturnType<typeof buildShortProps>,
  audioPath: string,
  outPath: string,
): Promise<void> {
  if (isMockAll()) {
    // Real bytes → exercises QA byte/hash gates. Padded so file > 100KB gate.
    const wav = cannedSilentWav(3);
    const pad = Buffer.alloc(Math.max(0, 120_000 - wav.length));
    writeFileSync(outPath, Buffer.concat([wav, pad]));
    return;
  }
  const bundleMod = await import('@remotion/bundler' as string).catch((e) => {
    throw new Error(`@remotion/bundler not installed: ${scrubError(e)}`);
  });
  const rendererMod = await import('@remotion/renderer' as string).catch((e) => {
    throw new Error(`@remotion/renderer not installed: ${scrubError(e)}`);
  });
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape (dep installed later)
  const bundle = (bundleMod as any).bundle;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape (dep installed later)
  const { selectComposition, renderMedia } = rendererMod as any;
  // Remotion's render server only fetches assets over http(s) or staticFile()
  // — a bare local path or file:// URL 404s ("Can only download URLs starting
  // with http:// or https://"). The narration is generated per-video at render
  // time, so the robust, public-dir-free way to feed it to <Audio> is a base64
  // `data:` URL passed through inputProps. (MOCK_ALL never reaches this branch.)
  const audioSrc = audioFileToDataUrl(audioPath);
  // The Remotion bundle entry MUST call registerRoot() (validated by
  // @remotion/bundler). That lives in entry.ts, NOT the index.ts barrel.
  const entry = join(process.cwd(), 'youtube', 'composition', 'entry.ts');
  const serveUrl = await bundle({ entryPoint: entry });
  const composition = await selectComposition({
    serveUrl,
    id: 'Short',
    inputProps: { ...props, audioSrc },
  });
  // Render crisp frames first (jpegQuality 100), then re-encode to a controlled
  // high 1080p bitrate. Remotion's h264 quality default compresses static text
  // to ~0.3 Mbps — which YouTube reads as low quality / is slow to offer HD —
  // and its `videoBitrate` option is a no-op for h264 here, so we own the final
  // encode with ffmpeg (see reencodeHighBitrate).
  const rawPath = `${outPath}.raw.mp4`;
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: rawPath,
    inputProps: { ...props, audioSrc },
    chromiumOptions: { ignoreCertificateErrors: false },
    timeoutInMilliseconds: 60000, // headroom for woff2 font loading (delayRender)
    jpegQuality: 100,
  });
  await reencodeHighBitrate(rawPath, outPath);
}

/**
 * Re-encode a rendered MP4 to a controlled high 1080p bitrate so YouTube serves
 * crisp HD (8 Mbps video / 192k AAC, +faststart for streaming). Consumes `src`.
 */
export async function reencodeHighBitrate(src: string, dst: string): Promise<void> {
  const ffmpegMod = await import('ffmpeg-static' as string).catch((e) => {
    throw new Error(`ffmpeg-static not installed: ${scrubError(e)}`);
  });
  const ffmpeg = (ffmpegMod as { default?: string }).default;
  if (!ffmpeg) throw new Error('ffmpeg-static resolved no binary path');
  // CBR ~8 Mbps. Static text compresses to a tiny bitrate under any
  // quality/ABR mode (x264 won't pad trivial content), which leaves YouTube a
  // thin source that it serves/processes as low quality. Forcing CBR makes the
  // 1080p source unambiguously HD (YouTube's 1080p30 SDR recommendation).
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
      '-b:v',
      '8M',
      '-minrate',
      '8M',
      '-maxrate',
      '8M',
      '-bufsize',
      '8M',
      '-x264-params',
      'nal-hrd=cbr',
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
    throw new Error(`ffmpeg re-encode failed (${code}): ${scrubError(err)}`);
  }
  const { rmSync } = await import('node:fs');
  rmSync(src, { force: true });
}

/**
 * Encode a render-time audio file as a base64 `data:` URL for Remotion
 * `<Audio>`. Returns null for a missing/empty file (→ silent render). MIME is
 * sniffed from the header so it's correct whether the TTS path wrote MP3
 * (Google's Phase-1 encoding) or a WAV.
 */
export function audioFileToDataUrl(audioPath: string): string | null {
  if (!existsSync(audioPath)) return null;
  const buf = readFileSync(audioPath);
  if (buf.length === 0) return null;
  // ID3 tag or MPEG frame sync (0xFFEx/0xFFFx) → MP3; "RIFF" → WAV.
  const isMp3 =
    (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || // "ID3"
    (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  const mime = isMp3 ? 'audio/mpeg' : 'audio/wav';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export interface ProbeResult {
  durationS: number;
  loudnessLufs: number;
  codecVideo: string;
  codecAudio: string;
}

/**
 * Parse the metrics the QA gate needs out of `ffmpeg -i … -af loudnorm` stderr.
 * The input-header Video/Audio streams print BEFORE the `-f null` output
 * streams, so first-match wins. Integrated loudness of pure silence is "-inf"
 * → −Infinity LUFS (correctly fails the "too quiet" gate).
 */
export function parseFfmpegProbe(stderr: string): ProbeResult {
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationS = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : Number.NaN;
  const v = stderr.match(/Stream #\d+:\d+[^\n]*: Video:\s*([A-Za-z0-9_]+)/);
  const a = stderr.match(/Stream #\d+:\d+[^\n]*: Audio:\s*([A-Za-z0-9_]+)/);
  const li = stderr.match(/"input_i"\s*:\s*"(-?(?:inf|\d+(?:\.\d+)?))"/i);
  let loudnessLufs = Number.NEGATIVE_INFINITY;
  if (li) {
    loudnessLufs = /inf/i.test(li[1])
      ? li[1].startsWith('-')
        ? Number.NEGATIVE_INFINITY
        : Number.POSITIVE_INFINITY
      : Number(li[1]);
  }
  return {
    durationS,
    loudnessLufs,
    codecVideo: v ? v[1] : 'unknown',
    codecAudio: a ? a[1] : 'unknown',
  };
}

/**
 * Probe a rendered MP4 for QA metrics via ffmpeg-static. `ffprobe` is NOT
 * bundled with ffmpeg-static, so a single `ffmpeg -i … -af loudnorm … -f null`
 * pass gives us the input header (Duration + codecs) and the integrated LUFS.
 */
export async function probeMp4(mp4Path: string): Promise<ProbeResult> {
  const ffmpegMod = await import('ffmpeg-static' as string).catch((e) => {
    throw new Error(`ffmpeg-static not installed: ${scrubError(e)}`);
  });
  const ffmpeg = (ffmpegMod as { default?: string }).default;
  if (!ffmpeg) throw new Error('ffmpeg-static resolved no binary path');
  const proc = Bun.spawn(
    [ffmpeg, '-hide_banner', '-i', mp4Path, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  const result = parseFfmpegProbe(stderr);
  if (Number.isNaN(result.durationS)) {
    throw new Error(`ffmpeg probe could not read duration from ${mp4Path}`);
  }
  return result;
}

/** Duration (seconds) of an audio file via ffmpeg-static (no ffprobe). */
export async function probeAudioDurationS(audioPath: string): Promise<number> {
  const ffmpegMod = await import('ffmpeg-static' as string).catch((e) => {
    throw new Error(`ffmpeg-static not installed: ${scrubError(e)}`);
  });
  const ffmpeg = (ffmpegMod as { default?: string }).default;
  if (!ffmpeg) throw new Error('ffmpeg-static resolved no binary path');
  const proc = Bun.spawn([ffmpeg, '-hide_banner', '-i', audioPath, '-f', 'null', '-'], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  const { durationS } = parseFfmpegProbe(stderr);
  if (Number.isNaN(durationS)) {
    throw new Error(`ffmpeg could not read audio duration from ${audioPath}`);
  }
  return durationS;
}

/**
 * Upload a local file to R2 at `key` via `aws s3 cp` (S3-compatible, matching
 * scripts/turso-backup.sh). MOCK_ALL → copy into the work dir instead.
 * Returns the bytes written. (Exported for chapter-render-engine reuse.)
 */
export async function uploadR2(localPath: string, key: string, workDir: string): Promise<number> {
  const bytes = readFileSync(localPath).length;
  if (isMockAll()) {
    const dest = join(workDir, 'r2', key.replace(/\//g, '__'));
    copyFileSync(localPath, dest);
    return bytes;
  }
  const r2 = getR2Creds();
  const proc = Bun.spawn(
    ['aws', 's3', 'cp', localPath, `s3://${r2.bucket}/${key}`, '--endpoint-url', r2.endpoint],
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
    throw new Error(`aws s3 cp failed (${code}): ${scrubError(err)}`);
  }
  return bytes;
}

/**
 * Render one video end-to-end. Mutates `db` (the videos DB) status on
 * completion. Returns a structured result; never throws for a per-video
 * failure (marks the row failed + returns status:'failed').
 */
export async function renderOne(
  db: Database,
  video: VideoRow,
  opts: RenderOpts = {},
): Promise<RenderResult> {
  const cfg = opts.cfg ?? loadYoutubeConfig();

  if (opts.dryRun) {
    return { videoId: video.id, status: 'skipped' };
  }

  const workDir = opts.workDir ?? mkdtempSync(join(tmpdir(), 'yt-render-'));
  // Ensure the mock R2 dir exists.
  if (isMockAll()) {
    const r2dir = join(workDir, 'r2');
    if (!existsSync(r2dir)) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(r2dir, { recursive: true });
    }
  }

  try {
    const preset = getStylePreset(cfg, video.style_preset);
    const content = resolveContent(video, cfg);

    const audioPath = join(workDir, `${video.id}.wav`);
    // Shorts narration speed (defaults.speaking_rate, 0.75) for clearer audio;
    // chapters synthesize without this arg and stay at 1.0.
    await synthesize(
      content.translation,
      video.tts_voice_id,
      content.langCode,
      audioPath,
      cfg.defaults.speaking_rate,
    );

    // Video length is derived from the narration: probe its duration so the
    // composition runs leadIn + narration + tail (MOCK_ALL's canned wav = 2s).
    const audioDurationS = isMockAll() ? 2 : await probeAudioDurationS(audioPath);

    const props = buildShortProps({
      textTitle: content.textTitle,
      reference: content.reference,
      devanagari: content.devanagari,
      iast: content.iast,
      translation: content.translation,
      translationFont: translationFontForLang(video.lang),
      preset,
      audioSrc: audioPath,
      audioDurationS,
      fps: cfg.defaults.fps,
    });

    const mp4Path = join(workDir, `${video.id}.mp4`);
    await renderMp4(props, audioPath, mp4Path);

    const bytes = readFileSync(mp4Path).length;
    const sha256 = sha256File(mp4Path);
    const localMd5 = md5File(mp4Path);

    // Probe the ACTUAL rendered file for the QA gate. MOCK_ALL writes a padded
    // byte blob (not a real MP4), so there we keep the assumed/config metrics
    // and exercise only the non-loudness gates; real renders measure duration,
    // integrated LUFS, and codecs with ffmpeg so a too-quiet / wrong-duration /
    // wrong-codec output is actually caught.
    let durationS = cfg.defaults.duration_s;
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

    const r2Key = buildR2Key(
      {
        text_id: video.text_id,
        chapter: video.chapter,
        verse_num: video.verse_num,
        lang: video.lang,
      },
      video.translation_md5,
    );
    await uploadR2(mp4Path, r2Key, workDir);

    // In MOCK_ALL the "remote etag" equals the local md5 (we copied bytes).
    const etag = localMd5;
    const qa = qaChecks({
      bytes,
      durationS,
      loudnessLufs,
      codecVideo,
      codecAudio,
      etag,
      localMd5,
    });

    if (!qa.pass) {
      updateVideoStatus(db, video.id, 'failed', {
        last_error: scrubError(`QA failed: ${qa.failures.join('; ')}`),
        last_error_phase: 'probe',
        r2_key: r2Key,
        output_bytes: bytes,
        output_file_sha256: sha256,
        retry_count: (video.retry_count ?? 0) + 1,
      });
      log(STAGE, 'QA failed', { video: video.id, failures: qa.failures.length });
      return { videoId: video.id, status: 'failed', qa, r2Key, sha256, bytes, durationS };
    }

    // QA pass → rendered then auto-approved (Cron A flips both).
    updateVideoStatus(db, video.id, 'approved', {
      r2_key: r2Key,
      output_bytes: bytes,
      output_file_sha256: sha256,
      duration_s: durationS,
      rendered_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      approved_by: 'auto-qa',
    });
    log(STAGE, 'approved', { video: video.id, bytes, r2: r2Key });
    return { videoId: video.id, status: 'approved', qa, r2Key, sha256, bytes, durationS };
  } catch (e) {
    const msg = scrubError(e);
    updateVideoStatus(db, video.id, 'failed', {
      last_error: msg,
      last_error_phase: 'render',
      retry_count: (video.retry_count ?? 0) + 1,
    });
    log(STAGE, 'render failed', { video: video.id });
    return { videoId: video.id, status: 'failed', error: msg };
  }
}
