#!/usr/bin/env bun
/**
 * scripts/youtube-backfill-pending.ts
 *
 * One-shot, idempotent populator for the `videos` lifecycle table. For each
 * youtube_eligible:true text in config, iterates its verses and inserts a
 * `pending` row per verse whose translation (in the target --lang, default
 * 'en') clears the text's `min_translation_status` floor. The target lang
 * must have a configured voice in cfg.voices (else the run is a clean no-op).
 *
 * Skips a verse when:
 *   - no translation row exists for the target lang, OR
 *   - its status is below the text's floor (meetsTranslationFloor==false).
 *
 * Idempotent: insertPending is INSERT OR IGNORE on the determinism key.
 * Warns (does NOT fail) if total rows clearing the floor < 149.
 *
 * Conforms to CLI-CONVENTIONS: --help/--json/--dry-run/--limit/--text-slug/--lang.
 */
import type { Database } from 'bun:sqlite';
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
import { loadYoutubeConfig } from '../pipeline/youtube/config';
import { translationMd5 } from '../pipeline/youtube/determinism';
import { isYoutubeEligible, meetsTranslationFloor } from '../pipeline/youtube/eligibility';
import { log, logError } from '../pipeline/youtube/log';
import { FFMPEG_VERSION, REMOTION_VERSION, TEMPLATE_VERSION } from '../pipeline/youtube/versions';
import { getDb, getText, listAllVerses } from '../src/lib/db';
import { getVideosDb, insertPending } from '../src/lib/videos-db';

const STAGE = 'plan';
const DEFAULT_LANG = 'en';
const PHASE1_FLOOR_TARGET = 149;

const USAGE = `youtube-backfill-pending — idempotent populator for the videos table

Usage:
  bun scripts/youtube-backfill-pending.ts [--dry-run] [--json] [--limit=N]
                                          [--text-slug=SLUG] [--lang=CODE]

Flags:
  --help            Show this help and exit 0
  --json            Emit a machine-readable JSON summary
  --dry-run         Plan only — print counts, write nothing
  --limit=N         Cap rows inserted/considered this run
  --text-slug=SLUG  Restrict to one eligible text
  --lang=CODE       Target lang to backfill (default 'en'; must have a voice)

Exit codes:
  0 ok    2 usage error    3 config gate
`;

interface PerText {
  slug: string;
  considered: number;
  inserted: number;
  skippedNoTranslation: number;
  skippedFloor: number;
  clearedFloor: number;
}

/** Resolve a verse's numeric id by (text_id, chapter, verse_num), or null. */
function getVerseId(
  corpus: Database,
  textId: string,
  chapter: number,
  verseNum: number,
): number | null {
  const r = corpus
    .query<{ id: number }, [string, number, number]>(
      'SELECT id FROM verses WHERE text_id = ? AND chapter = ? AND verse_num = ? LIMIT 1',
    )
    .get(textId, chapter, verseNum);
  return r ? r.id : null;
}

/** Pick the primary translation row (id, status, text) for a verse + lang. */
function pickTranslation(
  corpus: Database,
  verseId: number,
  lang: string,
): { id: number; status: string; text: string } | null {
  // Mirror getVerse() ordering — first published/reviewed/draft row wins.
  const r = corpus
    .query<{ id: number; status: string; translation_text: string }, [number, string]>(
      `SELECT id, status, translation_text
         FROM translations
        WHERE verse_id = ? AND lang = ?
        ORDER BY ai_assisted ASC, status ASC, created_at ASC
        LIMIT 1`,
    )
    .get(verseId, lang);
  return r ? { id: r.id, status: r.status, text: r.translation_text } : null;
}

function main(): void {
  let args: ReturnType<typeof parseCommonArgs>;
  try {
    args = parseCommonArgs(process.argv.slice(2));
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

  const targetLang = args.lang ?? DEFAULT_LANG;

  const cfg = loadYoutubeConfig();
  const corpus = getDb();
  const vdb = args.dryRun ? null : getVideosDb();

  // The target lang must have a configured voice (provider + voice_id) — else
  // the rendered videos would have no narration. Skip cleanly (exit 0) so a
  // typo'd lang doesn't insert voiceless rows.
  const voice = cfg.voices[targetLang];
  if (!voice) {
    log(
      STAGE,
      `lang ${targetLang} has no voice in cfg.voices (known: ${Object.keys(cfg.voices).join(', ')}) — nothing to do`,
    );
    if (args.json) {
      console.log(
        JSON.stringify(
          { dryRun: args.dryRun, lang: targetLang, totalInserted: 0, totalCleared: 0, perText: [] },
          null,
          2,
        ),
      );
    }
    return;
  }

  const eligibleSlugs = Object.keys(cfg.texts).filter((s) => isYoutubeEligible(cfg, s));
  const slugs = args.textSlug ? eligibleSlugs.filter((s) => s === args.textSlug) : eligibleSlugs;

  if (args.textSlug && slugs.length === 0) {
    log(STAGE, `text-slug ${args.textSlug} not eligible or unknown — nothing to do`);
  }

  const perText: PerText[] = [];
  let totalInserted = 0;
  let totalCleared = 0;
  const limit = args.limit ?? Number.POSITIVE_INFINITY;

  for (const slug of slugs) {
    const text = getText(slug);
    const tcfg = cfg.texts[slug];
    if (!text || !tcfg) continue;
    const floor = tcfg.min_translation_status ?? 'reviewed';

    const stat: PerText = {
      slug,
      considered: 0,
      inserted: 0,
      skippedNoTranslation: 0,
      skippedFloor: 0,
      clearedFloor: 0,
    };

    for (const { chapter, verse_num } of listAllVerses(slug)) {
      if (totalInserted >= limit) break;
      stat.considered += 1;

      const verseId = getVerseId(corpus, text.id, chapter, verse_num);
      if (verseId === null) {
        stat.skippedNoTranslation += 1;
        continue;
      }
      const tr = pickTranslation(corpus, verseId, targetLang);
      if (!tr) {
        stat.skippedNoTranslation += 1;
        continue;
      }
      if (!meetsTranslationFloor(tr.status, floor)) {
        stat.skippedFloor += 1;
        continue;
      }
      stat.clearedFloor += 1;
      totalCleared += 1;

      if (args.dryRun || !vdb) {
        stat.inserted += 1; // would-insert
        totalInserted += 1;
        continue;
      }

      insertPending(vdb, {
        text_id: text.id,
        chapter,
        verse_num,
        lang: targetLang,
        kula: tcfg.kula,
        style_preset: tcfg.style_preset,
        translation_md5: translationMd5(tr.text),
        template_version: TEMPLATE_VERSION,
        tts_voice_id: voice.voice_id,
        translation_row_id: tr.id,
        remotion_version: REMOTION_VERSION,
        ffmpeg_version: FFMPEG_VERSION,
        status: 'pending',
      });
      stat.inserted += 1;
      totalInserted += 1;
    }

    perText.push(stat);
  }

  const summary = {
    dryRun: args.dryRun,
    lang: targetLang,
    totalInserted,
    totalCleared,
    floorTarget: PHASE1_FLOOR_TARGET,
    belowFloorTarget: totalCleared < PHASE1_FLOOR_TARGET,
    perText,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    for (const t of perText) {
      log(STAGE, t.slug, {
        inserted: t.inserted,
        cleared: t.clearedFloor,
        'skip-notr': t.skippedNoTranslation,
        'skip-floor': t.skippedFloor,
      });
    }
    log(STAGE, args.dryRun ? 'dry-run complete' : 'backfill complete', {
      inserted: totalInserted,
      cleared: totalCleared,
    });
  }

  if (summary.belowFloorTarget) {
    // Warn, do NOT fail (exit 0) — partial corpus is allowed during build-out.
    console.error(
      `[youtube:${STAGE}] WARNING: only ${totalCleared} ${targetLang} rows clear the floor (< ${PHASE1_FLOOR_TARGET} target)`,
    );
  }
}

try {
  main();
} catch (e) {
  logError(STAGE, e);
  process.exit(1);
}
