#!/usr/bin/env bun
import { resolveChapterVerses } from '../pipeline/youtube/chapter-render-engine';
/**
 * scripts/youtube-backfill-chapters.ts
 *
 * Idempotent populator for CHAPTER-format `videos` rows (verse_num=0).
 * For each youtube_eligible text × chapter × cfg.chapters.langs:
 *   - gather every verse + its best translation (explicit status-priority
 *     CASE ordering published→reviewed→draft, floored at
 *     cfg.chapters.min_translation_status, non-empty text required)
 *   - skip + report combos with ANY missing verse translation (incomplete)
 *   - manifest → chapterContentMd5 → getLatestVideo(format='chapter')
 *   - shouldSkipRender (md5 + CHAPTER_TEMPLATE_VERSION match on a
 *     terminal-good row) → skip up-to-date
 *   - else markSuperseded(old,'manual') + insertPending(format:'chapter')
 *     (translation_row_id anchors to the FIRST verse's row — documented
 *     anchor; full per-verse provenance lives in the render sidecar)
 *
 * OPERATOR RULE: run via workflow_dispatch inside the `youtube-pipeline`
 * concurrency group — NEVER locally against a pulled state DB (the R2
 * state push is last-writer-wins).
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit/--text-slug/
 * --lang, plus --chapter=N.
 */
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { getChaptersConfig, loadYoutubeConfig } from '../pipeline/youtube/config';
import { chapterContentMd5 } from '../pipeline/youtube/determinism';
import { isYoutubeEligible } from '../pipeline/youtube/eligibility';
import { log, logError } from '../pipeline/youtube/log';
import {
  CHAPTER_TEMPLATE_VERSION,
  FFMPEG_VERSION,
  REMOTION_VERSION,
} from '../pipeline/youtube/versions';
import { getDb, getText, listChapters } from '../src/lib/db';
import {
  getLatestVideo,
  getVideosDb,
  insertPending,
  markSuperseded,
  shouldSkipRender,
} from '../src/lib/videos-db';

const STAGE = 'plan';

const USAGE = `youtube-backfill-chapters — idempotent populator for chapter-format videos rows

Usage:
  bun scripts/youtube-backfill-chapters.ts [--dry-run] [--json] [--limit=N]
                                           [--text-slug=SLUG] [--chapter=N] [--lang=CODE]

Flags:
  --help            Show this help and exit 0
  --json            Emit a machine-readable JSON summary
  --dry-run         Plan only — print counts, write nothing
  --limit=N         Cap rows inserted this run
  --text-slug=SLUG  Restrict to one eligible text
  --chapter=N       Restrict to one chapter number
  --lang=CODE       Restrict to one lang (default: all cfg.chapters.langs)

Notes:
  Run via workflow_dispatch (youtube-pipeline concurrency group), never
  locally against a pulled state DB (R2 push is last-writer-wins).

Exit codes:
  0 ok    1 runtime failure    2 usage error    3 config gate
`;

type ComboAction =
  | 'inserted'
  | 'already-queued'
  | 'skipped-up-to-date'
  | 'skipped-incomplete'
  | 'skipped-no-voice'
  | 'would-insert';

interface PerCombo {
  slug: string;
  chapter: number;
  lang: string;
  verses: number;
  action: ComboAction;
  superseded?: number; // old video id superseded this run
  missing?: string[]; // verse refs blocking an incomplete combo
}

function main(): void {
  let args: ReturnType<typeof parseCommonArgs>;
  try {
    args = parseCommonArgs(process.argv.slice(2), ['chapter']);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(e.message);
      process.exit(2);
    }
    throw e;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }

  let chapterFilter: number | undefined;
  if (args.extra.chapter !== undefined) {
    chapterFilter = Number.parseInt(args.extra.chapter, 10);
    if (!Number.isFinite(chapterFilter) || chapterFilter < 1) {
      console.error(`bad --chapter: ${args.extra.chapter}`);
      process.exit(2);
    }
  }

  const cfg = loadYoutubeConfig();
  const chaptersCfg = getChaptersConfig(cfg);
  const corpus = getDb();
  const vdb = args.dryRun ? null : getVideosDb();

  const langs = args.lang ? [args.lang] : chaptersCfg.langs;
  const limit = args.limit ?? Number.POSITIVE_INFINITY;

  const eligibleSlugs = Object.keys(cfg.texts).filter((s) => isYoutubeEligible(cfg, s));
  const slugs = args.textSlug ? eligibleSlugs.filter((s) => s === args.textSlug) : eligibleSlugs;
  if (args.textSlug && slugs.length === 0) {
    log(STAGE, `text-slug ${args.textSlug} not eligible or unknown — nothing to do`);
  }

  const perCombo: PerCombo[] = [];
  let totalInserted = 0;
  let totalSkippedUpToDate = 0;
  let totalIncomplete = 0;
  let totalSuperseded = 0;

  outer: for (const slug of slugs) {
    const text = getText(slug);
    const tcfg = cfg.texts[slug];
    if (!text || !tcfg) continue;

    const chapterRows = listChapters(slug).filter(
      (c) => chapterFilter === undefined || c.chapter === chapterFilter,
    );

    for (const { chapter } of chapterRows) {
      for (const lang of langs) {
        if (totalInserted >= limit) break outer;

        const voice = cfg.voices[lang];
        if (!voice) {
          perCombo.push({ slug, chapter, lang, verses: 0, action: 'skipped-no-voice' });
          continue;
        }

        const resolved = resolveChapterVerses(
          corpus,
          text.id,
          chapter,
          lang,
          chaptersCfg.min_translation_status,
          voice.voice_id,
        );

        if (resolved.missing.length > 0 || resolved.manifest.length === 0) {
          totalIncomplete += 1;
          perCombo.push({
            slug,
            chapter,
            lang,
            verses: resolved.manifest.length,
            action: 'skipped-incomplete',
            missing: resolved.missing,
          });
          continue;
        }

        const manifestMd5 = chapterContentMd5(resolved.manifest);
        const ident = {
          text_id: text.id,
          chapter,
          verse_num: 0,
          lang,
          short_index: 0,
          format: 'chapter' as const,
        };

        if (args.dryRun || !vdb) {
          perCombo.push({
            slug,
            chapter,
            lang,
            verses: resolved.manifest.length,
            action: 'would-insert',
          });
          totalInserted += 1;
          continue;
        }

        const latest = getLatestVideo(vdb, ident);
        if (shouldSkipRender(latest, manifestMd5, CHAPTER_TEMPLATE_VERSION)) {
          totalSkippedUpToDate += 1;
          perCombo.push({
            slug,
            chapter,
            lang,
            verses: resolved.manifest.length,
            action: 'skipped-up-to-date',
          });
          continue;
        }

        let supersededId: number | undefined;
        if (
          latest &&
          latest.status !== 'superseded' &&
          (latest.translation_md5 !== manifestMd5 ||
            latest.template_version !== CHAPTER_TEMPLATE_VERSION)
        ) {
          markSuperseded(vdb, latest.id, 'manual');
          supersededId = latest.id;
          totalSuperseded += 1;
        }

        const id = insertPending(vdb, {
          text_id: text.id,
          chapter,
          verse_num: 0, // chapter rows use 0 (corpus verses start at 1)
          lang,
          short_index: 0,
          format: 'chapter',
          kula: tcfg.kula,
          style_preset: tcfg.style_preset,
          translation_md5: manifestMd5,
          template_version: CHAPTER_TEMPLATE_VERSION,
          tts_voice_id: voice.voice_id,
          // Documented anchor: first verse's translation row (FK satisfied);
          // full per-verse provenance lives in the .meta.json sidecar.
          translation_row_id: resolved.manifest[0].translation_row_id,
          remotion_version: REMOTION_VERSION,
          ffmpeg_version: FFMPEG_VERSION,
          status: 'pending',
        });

        // insertPending is INSERT OR IGNORE on the determinism key: getting
        // the latest row's own id back means nothing new was inserted.
        const action: ComboAction = latest && latest.id === id ? 'already-queued' : 'inserted';
        perCombo.push({
          slug,
          chapter,
          lang,
          verses: resolved.manifest.length,
          action,
          superseded: supersededId,
        });
        totalInserted += 1;
      }
    }
  }

  const summary = {
    dryRun: args.dryRun,
    langs,
    totalInserted,
    totalSkippedUpToDate,
    totalIncomplete,
    totalSuperseded,
    perCombo,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const c of perCombo) {
      log(STAGE, `${c.slug} ch${c.chapter} ${c.lang}`, {
        verses: c.verses,
        action: c.action,
        ...(c.superseded ? { superseded: c.superseded } : {}),
        ...(c.missing && c.missing.length > 0 ? { missing: c.missing.length } : {}),
      });
      if (c.missing && c.missing.length > 0) {
        console.error(`[youtube:${STAGE}]   missing: ${c.missing.join(', ')}`);
      }
    }
    log(STAGE, args.dryRun ? 'dry-run complete' : 'chapter backfill complete', {
      inserted: totalInserted,
      'up-to-date': totalSkippedUpToDate,
      incomplete: totalIncomplete,
      superseded: totalSuperseded,
    });
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (e) {
    logError(STAGE, e);
    process.exit(1);
  }
}
