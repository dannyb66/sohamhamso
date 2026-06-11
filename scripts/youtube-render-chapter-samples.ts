#!/usr/bin/env bun
/**
 * youtube-render-chapter-samples.ts — M1 sample renderer for the CHAPTER
 * (16:9 full-chapter) composition. The operator pacing gate runs on these.
 *
 * Renders full chapters through the REAL `Chapter` composition into a local
 * folder, with per-verse TTS narration (Google) — or the canned silent WAV
 * when MOCK_ALL=true (the Day-0 zero-secret path: a real MP4, no creds).
 * No R2 / videos-DB / QA — purely a preview tool. Reuses the production
 * `buildChapterProps` mapper so what you see is what the chapter engine
 * renders.
 *
 * USAGE:
 *   MOCK_ALL=true bun run youtube:render-chapter-samples       # Day-0, no secrets
 *   bun scripts/youtube-render-chapter-samples.ts              # default sample set
 *   bun scripts/youtube-render-chapter-samples.ts --text-slug=spanda-karikas --chapter=2 --full
 *   bun scripts/youtube-render-chapter-samples.ts --variant=floor8 --out=samples-chapters
 *
 * FLAGS (CLI-CONVENTIONS + extras):
 *   --text-slug=SLUG   restrict to one text (requires --chapter or defaults to 1)
 *   --chapter=N        chapter number (with --text-slug)
 *   --limit=N          cap verses rendered per chapter
 *   --full             render every verse of the chapter (overrides --limit)
 *   --out=DIR          output dir (default samples-chapters)
 *   --variant=LABEL    label appended to output files + sidecar timing JSON,
 *                      so pacing variants compare side-by-side
 *   --lang=CODE        translation lang (default: chapters.langs[0] → en)
 *   --dry-run --json --help per CLI-CONVENTIONS
 *
 * DEFAULT SAMPLE SET (plan M1): spanda-karikas ch2 (full) + siva-sutras ch1
 * first 8 verses (short aphoristic sutras — the dead-air stress test).
 *
 * Each MP4 gets a sidecar `<name>.timing.json`:
 *   { segments: [{ verseNum, startS, durationS }], totalS }
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChapterProps } from '../pipeline/youtube/chapter-props';
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { getChaptersConfig, getStylePreset, loadYoutubeConfig } from '../pipeline/youtube/config';
import { log } from '../pipeline/youtube/log';
import { cannedSilentWav } from '../pipeline/youtube/mocks/canned';
import { getDb } from '../src/lib/db';
import { translationFontForLang } from '../youtube/composition/types';

const STAGE = 'chapter-samples';

const USAGE = `youtube-render-chapter-samples — render full-chapter sample MP4s (M1 pacing gate)

Usage:
  MOCK_ALL=true bun scripts/youtube-render-chapter-samples.ts   # Day-0 zero-secret path
  bun scripts/youtube-render-chapter-samples.ts [flags]

Flags:
  --text-slug=SLUG  one text (default: the plan's two-sample set)
  --chapter=N       chapter number (with --text-slug; default 1)
  --limit=N         cap verses per chapter
  --full            all verses (overrides --limit)
  --out=DIR         output dir (default samples-chapters)
  --variant=LABEL   label outputs for side-by-side pacing comparison
  --lang=CODE       translation lang (default en)
  --dry-run         plan only, no TTS/render
  --json            machine-readable summary on stdout
  --help            this text

Exit codes: 0 ok · 1 runtime failure · 2 usage · 3 config/gate (no eligible verses)`;

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  bn: 'Bengali',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
};

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpus resolution
// ─────────────────────────────────────────────────────────────────────────────

interface TextRow {
  id: string;
  slug: string;
  tradition: string;
  title_sa: string;
  title_en: string;
  title_iast: string | null;
  author: string | null;
}

interface VerseContentRow {
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_text: string;
  status: string;
}

/** Per-verse best translation: published > reviewed > draft, floored at `floor`. */
function resolveChapterVerses(
  textId: string,
  chapter: number,
  lang: string,
  floor: 'draft' | 'reviewed' | 'published',
): VerseContentRow[] {
  const db = getDb();
  const allowed =
    floor === 'draft'
      ? ['draft', 'reviewed', 'published']
      : floor === 'reviewed'
        ? ['reviewed', 'published']
        : ['published'];
  const rows = db
    .query<VerseContentRow, [string, number, string]>(
      `SELECT v.verse_num, v.devanagari, v.iast, t.translation_text, t.status
         FROM verses v
         JOIN translations t ON t.verse_id = v.id
        WHERE v.text_id = ? AND v.chapter = ? AND t.lang = ?
          AND t.status IN (${allowed.map((s) => `'${s}'`).join(',')})
        ORDER BY v.verse_num ASC,
                 CASE t.status WHEN 'published' THEN 0 WHEN 'reviewed' THEN 1 ELSE 2 END,
                 t.id ASC`,
    )
    .all(textId, chapter, lang);
  // First row per verse wins (explicit status-priority CASE, not ORDER BY status).
  const out: VerseContentRow[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (!seen.has(r.verse_num) && r.translation_text.trim().length > 0) {
      seen.add(r.verse_num);
      out.push(r);
    }
  }
  return out;
}

function getText(slug: string): TextRow | null {
  return (
    getDb()
      .query<TextRow, [string]>(
        'SELECT id, slug, tradition, title_sa, title_en, title_iast, author FROM texts WHERE slug = ? LIMIT 1',
      )
      .get(slug) ?? null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS (MOCK_ALL → canned silent WAV; real → Google, mirrors render-samples)
// ─────────────────────────────────────────────────────────────────────────────

async function synth(
  text: string,
  voice: string,
  langCode: string,
): Promise<{ dataUrl: string; durationS: number }> {
  if (isMockAll()) {
    const wav = cannedSilentWav(2);
    return { dataUrl: `data:audio/wav;base64,${wav.toString('base64')}`, durationS: 2 };
  }
  const mod = await import('@google-cloud/text-to-speech' as string);
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
  const m = mod as any;
  const Client = m.TextToSpeechClient ?? m.default?.TextToSpeechClient;
  const credsJson = process.env.GOOGLE_TTS_CREDENTIALS_JSON;
  const client = credsJson ? new Client({ credentials: JSON.parse(credsJson) }) : new Client();
  const [resp] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode: langCode, name: voice },
    audioConfig: { audioEncoding: 'MP3' },
  });
  const buf = Buffer.from(resp.audioContent as Uint8Array);
  const mp3 = join(tmpdir(), `chapter-sample-${Date.now()}.mp3`);
  writeFileSync(mp3, buf);
  const { probeAudioDurationS } = await import('../pipeline/youtube/render-engine');
  const durationS = await probeAudioDurationS(mp3);
  return { dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}`, durationS };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface Job {
  slug: string;
  chapter: number;
  /** undefined → all verses. */
  limit?: number;
}

interface RenderedSample {
  file: string;
  slug: string;
  chapter: number;
  verses: number;
  totalS: number;
  timingFile: string;
}

async function main(): Promise<void> {
  const args = parseCommonArgs(process.argv.slice(2), ['chapter', 'out', 'full', 'variant']);
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const outDir = join(process.cwd(), args.extra.out || 'samples-chapters');
  const variant = args.extra.variant || '';
  const full = 'full' in args.extra;

  const cfg = loadYoutubeConfig();
  const chapters = getChaptersConfig(cfg);
  const lang = args.lang ?? chapters.langs[0] ?? 'en';
  const langCode = lang === 'en' ? 'en-US' : `${lang}-IN`;
  const floor = chapters.min_translation_status;
  const fps = chapters.fps;
  // Pacing knobs — config-driven so the M1 gate loop is config-edit + re-run.
  const knobs = {
    titleCardS: chapters.title_card_s,
    outroS: chapters.outro_s,
    minSegS: chapters.min_seg_s,
    segLeadInS: chapters.seg_lead_in_s,
    segTailS: chapters.seg_tail_s,
  };

  // Job list: explicit --text-slug, else the plan's two-sample default set
  // (spanda ch2 full + siva-sutras ch1 first 8 = dead-air stress test).
  const jobs: Job[] = args.textSlug
    ? [
        {
          slug: args.textSlug,
          chapter: Number(args.extra.chapter || '1'),
          limit: full ? undefined : args.limit,
        },
      ]
    : [
        { slug: 'spanda-karikas', chapter: 2, limit: full ? undefined : args.limit },
        { slug: 'siva-sutras', chapter: 1, limit: full ? undefined : (args.limit ?? 8) },
      ];

  // Resolve all content first (cheap; lets --dry-run report the real plan).
  const resolved: Array<{ job: Job; text: TextRow; verses: VerseContentRow[] }> = [];
  for (const job of jobs) {
    const text = getText(job.slug);
    if (!text) {
      log(STAGE, 'unknown text slug', { slug: job.slug });
      process.exit(3);
    }
    let verses = resolveChapterVerses(text.id, job.chapter, lang, floor);
    if (verses.length === 0) {
      log(STAGE, 'no eligible verses', { slug: job.slug, chapter: job.chapter, lang, floor });
      process.exit(3);
    }
    if (job.limit !== undefined && job.limit > 0) verses = verses.slice(0, job.limit);
    resolved.push({ job, text, verses });
    log(STAGE, 'plan', {
      slug: job.slug,
      chapter: job.chapter,
      verses: verses.length,
      lang,
      floor,
      mock: isMockAll(),
    });
  }

  if (args.dryRun) {
    const plan = resolved.map((r) => ({
      slug: r.job.slug,
      chapter: r.job.chapter,
      verses: r.verses.length,
      translationLengths: r.verses.map((v) => v.translation_text.length),
    }));
    if (args.json) console.log(JSON.stringify({ dryRun: true, lang, knobs, plan }, null, 2));
    else log(STAGE, 'dry-run — would render', { jobs: plan.length });
    return;
  }

  mkdirSync(outDir, { recursive: true });

  const voice = cfg.voices[lang]?.voice_id ?? 'en-US-Studio-O';

  const { bundle } = await import('@remotion/bundler' as string);
  const { selectComposition, renderMedia } = await import('@remotion/renderer' as string);
  const { reencodeHighBitrate } = await import('../pipeline/youtube/render-engine');
  const entry = join(process.cwd(), 'youtube', 'composition', 'entry.ts');
  log(STAGE, 'bundling once');
  const serveUrl = await bundle({ entryPoint: entry });

  const results: RenderedSample[] = [];
  for (const { job, text, verses } of resolved) {
    const preset = getStylePreset(cfg, cfg.texts[job.slug].style_preset);
    const textTitle = text.title_iast || text.title_en;

    // Narrated title card: "The Spanda Kārikās of …. Chapter 2."
    const titleText = `${text.title_en}${text.author ? `, of ${text.author}` : ''}. Chapter ${job.chapter}.`;
    const title = await synth(titleText, voice, langCode);

    const verseContents = [];
    for (const v of verses) {
      const narration = await synth(v.translation_text, voice, langCode);
      verseContents.push({
        verseNum: v.verse_num,
        devanagari: v.devanagari,
        iast: v.iast ?? '',
        translation: v.translation_text,
        audioSrc: narration.dataUrl,
        narrationDurationS: narration.durationS,
      });
      log(STAGE, 'tts', { verse: `${job.chapter}.${v.verse_num}`, s: narration.durationS });
    }

    const props = buildChapterProps({
      textTitle,
      textTitleDevanagari: text.title_sa,
      chapter: job.chapter,
      chapterName: null, // corpus has no per-chapter section names today
      lang,
      langLabel: LANG_LABELS[lang] ?? lang,
      preset,
      translationFont: translationFontForLang(lang),
      outroUrl: `sohamhamso.org/${text.tradition}/${job.slug}/${job.chapter}`,
      verses: verseContents,
      titleCardAudioSrc: title.dataUrl,
      titleNarrationS: title.durationS,
      fps,
      ...knobs,
    });

    const base = `${job.slug}-ch${job.chapter}${variant ? `-${variant}` : ''}`;
    const out = join(outDir, `${base}.mp4`);
    const rawOut = `${out}.raw.mp4`;
    const composition = await selectComposition({ serveUrl, id: 'Chapter', inputProps: props });
    await renderMedia({
      serveUrl,
      composition,
      codec: 'h264',
      outputLocation: rawOut,
      inputProps: props,
      timeoutInMilliseconds: 120000, // headroom for woff2 font loading
      jpegQuality: 100,
    });
    await reencodeHighBitrate(rawOut, out);

    // Sidecar timing summary — the pacing-gate artifact (side-by-side compare).
    const totalS = props.durationInFrames / props.fps;
    const timing = {
      segments: props.segments.map((s) => ({
        verseNum: s.verseNum,
        startS: Number((s.startFrame / props.fps).toFixed(3)),
        durationS: Number((s.durationInFrames / props.fps).toFixed(3)),
      })),
      totalS: Number(totalS.toFixed(3)),
    };
    const timingFile = join(outDir, `${base}.timing.json`);
    writeFileSync(timingFile, `${JSON.stringify(timing, null, 2)}\n`);

    log(STAGE, 'rendered', {
      file: `${base}.mp4`,
      verses: verses.length,
      seconds: totalS.toFixed(1),
    });
    results.push({
      file: out,
      slug: job.slug,
      chapter: job.chapter,
      verses: verses.length,
      totalS,
      timingFile,
    });
  }

  if (args.json)
    console.log(JSON.stringify({ outDir, variant: variant || null, results }, null, 2));
  log(STAGE, 'done', { dir: outDir, count: results.length });
}

main().catch((e) => {
  if (e instanceof UsageError) {
    console.error(`usage error: ${e.message}\n\n${USAGE}`);
    process.exit(2);
  }
  log(STAGE, 'FAILED', { error: String((e as Error)?.message ?? e) });
  process.exit(1);
});
