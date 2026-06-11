#!/usr/bin/env bun
/**
 * youtube-render-indic-pilot.ts — local multi-language eyeball.
 *
 * Renders a couple of siva-sutras verses in each Indic language through the
 * REAL composition + Google TTS into ./samples-indic/, plus a still frame per
 * video, so we can confirm (a) each script's font shapes without tofu and
 * (b) each language's TTS voice works — BEFORE wiring Indic into the crons.
 *
 * Sanskrit Devanāgarī + IAST are identical across languages; only the
 * translation line (text + script font) and the narration voice change.
 *
 * USAGE:
 *   bun run youtube:render-indic-pilot                       # 9 langs × 1.1,1.2
 *   bun run youtube:render-indic-pilot --langs=ta,te --verses=1.1
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getStylePreset, loadYoutubeConfig } from '../pipeline/youtube/config';
import { log } from '../pipeline/youtube/log';
import { buildShortProps } from '../pipeline/youtube/remotion-props';
import { getDb } from '../src/lib/db';
import { translationFontForLang } from '../youtube/composition/types';

const STAGE = 'indic-pilot';
const DEFAULT_LANGS = ['hi', 'ta', 'te', 'kn', 'ml', 'bn', 'mr', 'gu', 'pa'];
const DEFAULT_VERSES = ['1.1', '1.2'];
const SLUG = 'siva-sutras';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

interface Verse {
  devanagari: string;
  iast: string | null;
  translation_text: string;
  title_iast: string | null;
  title_en: string;
}

function loadVerse(lang: string, chapter: number, verse: number): Verse | null {
  const db = getDb();
  return (
    db
      .query<Verse, [string, string, number, number]>(
        `SELECT v.devanagari, v.iast, t.translation_text, x.title_iast, x.title_en
           FROM verses v
           JOIN texts x ON x.id = v.text_id
           JOIN translations t ON t.verse_id = v.id AND t.lang = ?
          WHERE x.slug = ? AND v.chapter = ? AND v.verse_num = ?
          LIMIT 1`,
      )
      .get(lang, SLUG, chapter, verse) ?? null
  );
}

// biome-ignore lint/suspicious/noExplicitAny: dynamic TTS client shape
async function makeTtsClient(): Promise<any> {
  const mod = await import('@google-cloud/text-to-speech' as string);
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
  const m = mod as any;
  const Client = m.TextToSpeechClient ?? m.default?.TextToSpeechClient;
  const credsJson = process.env.GOOGLE_TTS_CREDENTIALS_JSON;
  return credsJson ? new Client({ credentials: JSON.parse(credsJson) }) : new Client();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const langs = (args.langs ? args.langs.split(',') : DEFAULT_LANGS).map((s) => s.trim());
  const verses = (args.verses ? args.verses.split(',') : DEFAULT_VERSES).map((s) => s.trim());
  const outDir = join(process.cwd(), args.out ?? 'samples-indic');
  mkdirSync(outDir, { recursive: true });

  const cfg = loadYoutubeConfig();
  const preset = getStylePreset(cfg, cfg.texts[SLUG].style_preset);

  const { bundle } = await import('@remotion/bundler' as string);
  const { selectComposition, renderMedia } = await import('@remotion/renderer' as string);
  const { default: ffmpeg } = await import('ffmpeg-static' as string);
  const entry = join(process.cwd(), 'youtube', 'composition', 'entry.ts');
  log(STAGE, 'bundling once');
  const serveUrl = await bundle({ entryPoint: entry });
  const tts = await makeTtsClient();

  const results: string[] = [];
  for (const lang of langs) {
    const voice = cfg.voices[lang];
    if (!voice) {
      log(STAGE, `no voice configured for ${lang} — skipping`);
      continue;
    }
    const langCode = lang === 'en' ? 'en-US' : `${lang}-IN`;
    for (const ref of verses) {
      const [chapter, verse] = ref.split('.').map(Number);
      const v = loadVerse(lang, chapter, verse);
      if (!v) {
        log(STAGE, `no ${lang} translation for ${SLUG} ${ref} — skipping`);
        continue;
      }
      // TTS (verifies the voice id is valid + audio for this language).
      let dataUrl: string | null = null;
      let durationS = 0;
      let ttsNote = 'ok';
      try {
        const [resp] = await tts.synthesizeSpeech({
          input: { text: v.translation_text },
          voice: { languageCode: langCode, name: voice.voice_id },
          audioConfig: { audioEncoding: 'MP3' },
        });
        const buf = Buffer.from(resp.audioContent as Uint8Array);
        dataUrl = `data:audio/mpeg;base64,${buf.toString('base64')}`;
        // probe duration via ffmpeg
        const { writeFileSync } = await import('node:fs');
        const tmp = join(outDir, `.${lang}-${ref}.mp3`);
        writeFileSync(tmp, buf);
        const proc = Bun.spawn([ffmpeg, '-hide_banner', '-i', tmp, '-f', 'null', '-'], {
          stdout: 'ignore',
          stderr: 'pipe',
        });
        const err = await new Response(proc.stderr).text();
        await proc.exited;
        const mm = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        durationS = mm ? Number(mm[1]) * 3600 + Number(mm[2]) * 60 + Number(mm[3]) : 0;
        const { rmSync } = await import('node:fs');
        rmSync(tmp, { force: true });
      } catch (e) {
        ttsNote = `TTS FAILED: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
        log(STAGE, `${lang} ${ref} ${ttsNote}`);
      }

      const props = buildShortProps({
        textTitle: v.title_iast || v.title_en,
        reference: ref,
        devanagari: v.devanagari,
        iast: v.iast ?? '',
        translation: v.translation_text,
        preset,
        translationFont: translationFontForLang(lang),
        audioSrc: dataUrl,
        audioDurationS: durationS,
        fps: 30,
      });
      const base = `${SLUG}-${lang}-${ref}`;
      const out = join(outDir, `${base}.mp4`);
      const composition = await selectComposition({ serveUrl, id: 'Short', inputProps: props });
      await renderMedia({
        serveUrl,
        composition,
        codec: 'h264',
        outputLocation: out,
        inputProps: props,
        timeoutInMilliseconds: 60000,
        jpegQuality: 100,
      });
      // still frame mid-video for a quick font check
      const frame = join(outDir, `${base}.png`);
      const fp = Bun.spawn(
        [ffmpeg, '-y', '-ss', '5', '-i', out, '-frames:v', '1', frame],
        { stdout: 'ignore', stderr: 'ignore' },
      );
      await fp.exited;
      log(STAGE, 'rendered', { file: `${base}.mp4`, font: translationFontForLang(lang), tts: ttsNote });
      results.push(`${lang} ${ref}: tts=${ttsNote === 'ok' ? `${durationS.toFixed(1)}s` : ttsNote}`);
    }
  }
  log(STAGE, 'done', { dir: outDir, n: results.length });
  for (const r of results) console.log('  ', r);
}

main().catch((e) => {
  log(STAGE, 'FAILED', { error: String(e?.message ?? e) });
  process.exit(1);
});
