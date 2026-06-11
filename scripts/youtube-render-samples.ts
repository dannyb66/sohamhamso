#!/usr/bin/env bun
/**
 * youtube-render-samples.ts — VISUAL QA preview renderer.
 *
 * Renders a curated length-spread of real verses (shortest → longest English
 * translation) through the REAL composition + Google TTS into a local folder,
 * for eyeballing layout/timing across the corpus. No R2 / DB / QA — purely a
 * preview tool. Reuses the production `buildShortProps` mapper so what you see
 * is what Cron A renders.
 *
 * USAGE:
 *   bun run youtube:render-samples                 # → ./samples/*.mp4
 *   bun run youtube:render-samples --out=samples --count=6
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getStylePreset, loadYoutubeConfig } from '../pipeline/youtube/config';
import { log } from '../pipeline/youtube/log';
import { buildShortProps } from '../pipeline/youtube/remotion-props';
import { getDb } from '../src/lib/db';

const STAGE = 'render-samples';

interface VerseRow {
  slug: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_text: string;
  title_iast: string | null;
  title_en: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = 'true';
  }
  return out;
}

/** Pick a spread of verses across the translation-length distribution. */
function selectSpread(count: number): VerseRow[] {
  const db = getDb();
  const rows = db
    .query<VerseRow, []>(
      `SELECT x.slug, v.chapter, v.verse_num, v.devanagari, v.iast,
              t.translation_text, x.title_iast, x.title_en
         FROM translations t
         JOIN verses v ON v.id = t.verse_id
         JOIN texts  x ON x.id = v.text_id
        WHERE t.lang = 'en'
          AND t.status IN ('reviewed','published')
          AND x.slug IN ('siva-sutras','spanda-karikas','pratyabhijna-hrdayam')
        ORDER BY LENGTH(t.translation_text) ASC`,
    )
    .all();
  if (rows.length === 0) return [];
  // Evenly sample the sorted-by-length list so we span shortest → longest,
  // and always include the very longest (the layout stress case).
  const picks: VerseRow[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) {
    const idx = Math.min(rows.length - 1, Math.round((i / (count - 1)) * (rows.length - 1)));
    if (!seen.has(idx)) {
      seen.add(idx);
      picks.push(rows[idx]);
    }
  }
  return picks;
}

async function synth(text: string, voice: string): Promise<{ dataUrl: string; durationS: number }> {
  const mod = await import('@google-cloud/text-to-speech' as string);
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
  const m = mod as any;
  const Client = m.TextToSpeechClient ?? m.default?.TextToSpeechClient;
  // Prefer inline service-account JSON (GOOGLE_TTS_CREDENTIALS_JSON — what the
  // GitHub Actions crons set); the Google auth lib does NOT read that env var
  // itself, so pass it explicitly. Otherwise fall back to ADC /
  // GOOGLE_APPLICATION_CREDENTIALS (local dev).
  const credsJson = process.env.GOOGLE_TTS_CREDENTIALS_JSON;
  const client = credsJson
    ? new Client({ credentials: JSON.parse(credsJson) })
    : new Client();
  const [resp] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: 'en-US', name: voice },
    audioConfig: { audioEncoding: 'MP3' },
  });
  const buf = Buffer.from(resp.audioContent as Uint8Array);
  const mp3 = join(tmpdir(), 'sample-narration.mp3');
  writeFileSync(mp3, buf);
  const { default: ffmpeg } = await import('ffmpeg-static' as string);
  const proc = Bun.spawn([ffmpeg, '-hide_banner', '-i', mp3, '-f', 'null', '-'], {
    stdout: 'ignore',
    stderr: 'pipe',
  });
  const err = await new Response(proc.stderr).text();
  await proc.exited;
  const mm = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationS = mm ? Number(mm[1]) * 3600 + Number(mm[2]) * 60 + Number(mm[3]) : 0;
  return { dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`, durationS };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outDir = join(process.cwd(), args.out ?? 'samples');
  const count = Number(args.count ?? 6);
  mkdirSync(outDir, { recursive: true });

  const cfg = loadYoutubeConfig();
  const verses = selectSpread(count);
  if (verses.length === 0) {
    log(STAGE, 'no eligible verses found');
    return;
  }
  log(STAGE, 'selected verses', {
    n: verses.length,
    lengths: verses.map((v) => v.translation_text.length).join(','),
  });

  const { bundle } = await import('@remotion/bundler' as string);
  const { selectComposition, renderMedia } = await import('@remotion/renderer' as string);
  const { reencodeHighBitrate } = await import('../pipeline/youtube/render-engine');
  const entry = join(process.cwd(), 'youtube', 'composition', 'entry.ts');
  log(STAGE, 'bundling once');
  const serveUrl = await bundle({ entryPoint: entry });

  for (const v of verses) {
    const tcfg = cfg.texts[v.slug];
    const preset = getStylePreset(cfg, tcfg.style_preset);
    const voice = cfg.voices.en?.voice_id ?? 'en-US-Studio-O';
    const { dataUrl, durationS } = await synth(v.translation_text, voice);
    const props = buildShortProps({
      textTitle: v.title_iast || v.title_en,
      reference: `${v.chapter}.${v.verse_num}`,
      devanagari: v.devanagari,
      iast: v.iast ?? '',
      translation: v.translation_text,
      preset,
      audioSrc: dataUrl,
      audioDurationS: durationS,
      fps: 30,
    });
    const out = join(outDir, `${v.slug}-${v.chapter}.${v.verse_num}.mp4`);
    const rawOut = `${out}.raw.mp4`;
    const composition = await selectComposition({ serveUrl, id: 'Short', inputProps: props });
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      outputLocation: rawOut,
      inputProps: props,
      timeoutInMilliseconds: 60000, // headroom for woff2 font loading
      jpegQuality: 100,
    });
    await reencodeHighBitrate(rawOut, out); // match production HD bitrate
    log(STAGE, 'rendered', {
      file: `${v.slug}-${v.chapter}.${v.verse_num}.mp4`,
      transLen: v.translation_text.length,
      seconds: (composition.durationInFrames / composition.fps).toFixed(1),
    });
  }
  log(STAGE, 'done', { dir: outDir, count: verses.length });
}

main().catch((e) => {
  log(STAGE, 'FAILED', { error: String(e?.message ?? e) });
  process.exit(1);
});
