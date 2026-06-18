#!/usr/bin/env bun
/**
 * youtube-render-speed-samples.ts — A/B/C narration-speed test for shorts.
 *
 * Synthesizes the SAME English verse at Google-TTS `speakingRate` 1.0 / 0.9 / 0.8
 * and renders a real "Short" for each so we can compare audio clarity. Video
 * length stays audio-derived (slower speech → proportionally longer video),
 * exactly as production does. Throwaway driver — does NOT touch the committed
 * pipeline; the real knob (if we adopt one) goes in tts-request.ts + config.
 *
 * USAGE:
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.config/sohamhamso/google-tts.json \
 *     bun run scripts/youtube-render-speed-samples.ts
 *   → /tmp/yt-speed-1.0.mp4  /tmp/yt-speed-0.9.mp4  /tmp/yt-speed-0.8.mp4
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, statSync } from 'node:fs';
import { log } from '../pipeline/youtube/log';
import { buildShortProps } from '../pipeline/youtube/remotion-props';

const STAGE = 'speed-samples';

// Śiva Sūtra 1.45 — full verse fields, EXACTLY as the corpus stores them, so
// the narration (TEXT) and the on-screen translation are the same string.
const TEXT =
  'Again and again, let there be pratimīlana — (the simultaneous turning of the gaze inward upon the Self and outward upon the world as Śiva).';
const VERSE = {
  textTitle: 'Śiva Sūtra',
  reference: '1.45',
  devanagari: 'भूयः स्यात्प्रतिमीलनम् ॥४५॥',
  iast: 'bhūyaḥ syāt pratimīlanam',
  translation: TEXT,
  preset: {
    bg: '#0E1B2E',
    accent: '#C9A961',
    text: '#E8E4D8',
    headline_font: 'EB Garamond',
    body_font: 'EB Garamond',
    devanagari_font: 'Noto Serif Devanagari',
    footer_line: 'Trika Śaiva canon · sohamhamso.org',
    ornament: 'none',
  },
};
const VOICE = 'en-US-Studio-O';
const RATES = [0.75, 0.7];

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

async function synth(rate: number): Promise<{ dataUrl: string; durationS: number }> {
  const mod = await import('@google-cloud/text-to-speech' as string);
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
  const m = mod as any;
  const Client = m.TextToSpeechClient ?? m.default?.TextToSpeechClient;
  const client = new Client();
  const [resp] = await client.synthesizeSpeech({
    input: { text: TEXT },
    voice: { languageCode: 'en-US', name: VOICE },
    audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
  });
  const buf = Buffer.from(resp.audioContent as Uint8Array);
  const mp3Path = join(tmpdir(), `yt-speed-${rate}.mp3`);
  writeFileSync(mp3Path, buf);
  const durationS = await probeAudioSeconds(mp3Path);
  log(STAGE, 'synthesized', { rate, durationS: durationS.toFixed(2), bytes: buf.length });
  return { dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`, durationS };
}

async function main(): Promise<void> {
  const entry = join(process.cwd(), 'youtube', 'composition', 'entry.ts');
  const { bundle } = await import('@remotion/bundler' as string);
  const { selectComposition, renderMedia } = await import('@remotion/renderer' as string);
  const { reencodeHighBitrate } = await import('../pipeline/youtube/render-engine');

  log(STAGE, 'bundling composition once', { entry });
  const serveUrl = await bundle({ entryPoint: entry });
  const fps = 30;

  for (const rate of RATES) {
    const audio = await synth(rate);
    // Full per-verse props so the on-screen text matches the narration, and the
    // length is audio-derived — identical to the production render path.
    const inputProps = buildShortProps({
      ...VERSE,
      audioSrc: audio.dataUrl,
      audioDurationS: audio.durationS,
      fps,
    });
    const composition = await selectComposition({ serveUrl, id: 'Short', inputProps });
    const outPath = `/tmp/yt-speed-${rate}.mp4`;
    const rawOut = `${outPath}.raw.mp4`;
    log(STAGE, 'rendering', {
      rate,
      seconds: (inputProps.durationInFrames / fps).toFixed(2),
      out: outPath,
    });
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      outputLocation: rawOut,
      inputProps,
      timeoutInMilliseconds: 60000,
      jpegQuality: 100,
    });
    await reencodeHighBitrate(rawOut, outPath);
    log(STAGE, 'done', { rate, out: outPath, bytes: statSync(outPath).size });
  }

  log(STAGE, 'ALL DONE', { files: RATES.map((r) => `/tmp/yt-speed-${r}.mp4`).join('  ') });
}

main().catch((e) => {
  log(STAGE, 'FAILED', { error: String(e?.message ?? e) });
  process.exit(1);
});
