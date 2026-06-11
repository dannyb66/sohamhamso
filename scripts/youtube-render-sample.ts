#!/usr/bin/env bun
/**
 * youtube-render-sample.ts — REAL Remotion render smoke (no creds needed).
 *
 * Unlike the MOCK_ALL unit/integration path (which writes a canned byte blob),
 * this actually bundles `youtube/composition/entry.ts`, drives headless
 * Chromium, loads the EB Garamond + Noto Serif Devanagari woff2 fonts, and
 * encodes a real h264+aac MP4 of the "Short" composition.
 *
 * AUDIO: if Google TTS creds are present (and MOCK_ALL!=true) it synthesizes
 * the verse translation and muxes narration in (same base64 `data:` URL path
 * the production render-engine uses); otherwise it renders SILENT — so it
 * still works as a zero-credential visual smoke.
 *
 * First run downloads Chrome Headless Shell (~90MB) via @remotion/renderer.
 *
 * USAGE:
 *   bun run youtube:render-sample                 # → /tmp/youtube-sample.mp4 (narrated if TTS creds set)
 *   bun run youtube:render-sample --silent        # force no audio
 *   bun run youtube:render-sample --out=foo.mp4
 *   bun run youtube:render-sample --frame=300 --frame-out=frame.png
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log } from '../pipeline/youtube/log';
import { computeTiming } from '../pipeline/youtube/remotion-props';

const STAGE = 'render-sample';

// The Śiva Sūtra 1.1 sample translation (matches the composition's default props).
const SAMPLE_TRANSLATION = 'Consciousness is the Self.';
const SAMPLE_VOICE = 'en-US-Studio-O';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = 'true';
  }
  return out;
}

/** Duration (seconds) of an audio file via ffmpeg-static, or 0 if unknown. */
async function probeAudioSeconds(path: string): Promise<number> {
  const ffmpegMod = await import('ffmpeg-static' as string).catch(() => null);
  const ffmpeg = (ffmpegMod as { default?: string } | null)?.default;
  if (!ffmpeg) return 0;
  const proc = Bun.spawn([ffmpeg, '-hide_banner', '-i', path, '-f', 'null', '-'], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/**
 * Synthesize the sample line via Google TTS → base64 `data:` URL (the form
 * Remotion `<Audio>` accepts at render time) plus its measured duration.
 * Returns null to render silent when `--silent`, MOCK_ALL, or no creds — so
 * the smoke never hard-fails.
 */
async function synthAudio(
  silent: boolean,
): Promise<{ dataUrl: string; durationS: number } | null> {
  if (silent || process.env.MOCK_ALL === 'true') return null;
  const hasCreds =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_TTS_CREDENTIALS_JSON ||
    process.env.GOOGLE_TTS_API_KEY;
  if (!hasCreds) {
    log(STAGE, 'no Google TTS creds — rendering silent (pass creds or --silent to suppress)');
    return null;
  }
  const mod = await import('@google-cloud/text-to-speech' as string).catch(() => null);
  if (!mod) {
    log(STAGE, '@google-cloud/text-to-speech not installed — rendering silent');
    return null;
  }
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
  const m = mod as any;
  const Client = m.TextToSpeechClient ?? m.default?.TextToSpeechClient;
  const client = new Client();
  const [resp] = await client.synthesizeSpeech({
    input: { text: SAMPLE_TRANSLATION },
    voice: { languageCode: 'en-US', name: SAMPLE_VOICE },
    audioConfig: { audioEncoding: 'MP3' },
  });
  const buf = Buffer.from(resp.audioContent as Uint8Array);
  // Write to a temp file so we can probe the narration's real length.
  const { writeFileSync } = await import('node:fs');
  const mp3Path = join(tmpdir(), 'youtube-sample-narration.mp3');
  writeFileSync(mp3Path, buf);
  const durationS = await probeAudioSeconds(mp3Path);
  log(STAGE, 'TTS synthesized', { voice: SAMPLE_VOICE, bytes: buf.length, durationS });
  return { dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`, durationS };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out ?? '/tmp/youtube-sample.mp4';

  // Same entry the production render-engine uses — must call registerRoot().
  const entry = join(process.cwd(), 'youtube', 'composition', 'entry.ts');

  const { bundle } = await import('@remotion/bundler' as string).catch((e) => {
    throw new Error(`@remotion/bundler not installed (run \`bun install\`): ${e}`);
  });
  const { selectComposition, renderMedia } = await import('@remotion/renderer' as string).catch(
    (e) => {
      throw new Error(`@remotion/renderer not installed (run \`bun install\`): ${e}`);
    },
  );

  const fps = 30;
  const audio = await synthAudio(Boolean(args.silent));
  // Length is derived from the narration (leadIn + narration + tail), same as
  // the production render-engine. Silent → 0s → the MIN_TOTAL_S floor applies.
  const { audioStartFrame, durationInFrames } = computeTiming(audio?.durationS ?? 0, fps);
  const inputProps = {
    audioStartFrame,
    durationInFrames,
    fps,
    ...(audio ? { audioSrc: audio.dataUrl } : {}),
  };

  log(STAGE, 'bundling composition', { entry });
  const serveUrl = await bundle({ entryPoint: entry });

  log(STAGE, 'selecting composition', { id: 'Short' });
  const composition = await selectComposition({ serveUrl, id: 'Short', inputProps });
  log(STAGE, 'composition selected', {
    id: composition.id,
    dims: `${composition.width}x${composition.height}`,
    frames: composition.durationInFrames,
    seconds: (composition.durationInFrames / composition.fps).toFixed(2),
    audioStartFrame,
  });

  log(STAGE, 'rendering (downloads Chrome Headless Shell on first run)', {
    out: outPath,
    audio: audio ? 'narrated' : 'silent',
  });
  const { reencodeHighBitrate } = await import('../pipeline/youtube/render-engine');
  const rawOut = `${outPath}.raw.mp4`;
  await renderMedia({
    serveUrl,
    composition,
    codec: 'h264',
    outputLocation: rawOut,
    inputProps,
    timeoutInMilliseconds: 60000, // headroom for woff2 font loading
    jpegQuality: 100,
  });
  // Match production: re-encode to a controlled high 1080p bitrate (static text
  // otherwise compresses to ~0.3 Mbps, which YouTube serves as low quality).
  await reencodeHighBitrate(rawOut, outPath);

  const { statSync } = await import('node:fs');
  const bytes = statSync(outPath).size;
  log(STAGE, 'done', { out: outPath, bytes });

  // Optional: extract a single verification frame via ffmpeg-static.
  if (args.frame || args['frame-out']) {
    const frameOut = args['frame-out'] ?? '/tmp/youtube-sample-frame.png';
    const frameNo = args.frame ? Number(args.frame) : Math.floor(composition.durationInFrames / 2);
    const atSec = (frameNo / composition.fps).toFixed(3);
    const ffmpegMod = await import('ffmpeg-static' as string).catch(() => null);
    const ffmpeg = (ffmpegMod as { default?: string } | null)?.default;
    if (!ffmpeg) {
      log(STAGE, 'ffmpeg-static unavailable — skipping frame extraction');
    } else {
      const proc = Bun.spawn(
        [ffmpeg, '-y', '-ss', atSec, '-i', outPath, '-frames:v', '1', frameOut],
        { stdout: 'ignore', stderr: 'ignore' },
      );
      const code = await proc.exited;
      if (code === 0) log(STAGE, 'frame extracted', { frameOut, atSec });
      else log(STAGE, 'frame extraction failed', { code });
    }
  }
}

main().catch((e) => {
  log(STAGE, 'FAILED', { error: String(e?.message ?? e) });
  process.exit(1);
});
