#!/usr/bin/env bun
/**
 * youtube-update-seo.ts — re-apply the SEO-optimized metadata to videos that
 * are already on YouTube (one-time backfill after improving the metadata
 * builder; safe to re-run, it just re-sets title/description/tags/category).
 *
 * For each `uploaded` row in the (R2-synced) state DB it rebuilds the snippet
 * via the SAME buildUploadMetadata the upload cron uses, then calls
 * youtube.videos.update. videos.update replaces the snippet wholesale and
 * REQUIRES categoryId — we set it explicitly (27 = Education) rather than
 * reading the current value (videos.list needs a read scope this token lacks).
 *
 * USAGE:
 *   YOUTUBE_DB_PATH=<state.db> bun scripts/youtube-update-seo.ts [--limit=N] [--dry-run]
 *   MOCK_ALL=true → DB-only, no YouTube call.
 */
import { getDb } from '../src/lib/db';
import { log, scrubError } from '../pipeline/youtube/log';
import { getYoutubeOAuth } from '../pipeline/youtube/secrets';
import { buildUploadMetadata } from '../pipeline/youtube/upload-metadata';
import { addQuotaUnits, getVideosDb, listByStatus, type VideoRow } from '../src/lib/videos-db';

const STAGE = 'update-seo';
const CANONICAL_BASE = 'https://sohamhamso.org';
const CATEGORY_ID = '27'; // Education
const UNITS_PER_UPDATE = 50;

function isMockAll(): boolean {
  return process.env.MOCK_ALL === 'true';
}

function resolveMeta(video: VideoRow): {
  textTitle: string;
  translation: string;
  canonicalUrl: string;
  iast: string;
  devanagari: string;
} {
  const corpus = getDb();
  const text = corpus
    .query<{ title_iast: string | null; title_en: string; slug: string }, [string]>(
      'SELECT title_iast, title_en, slug FROM texts WHERE id = ? LIMIT 1',
    )
    .get(video.text_id);
  const tr = corpus
    .query<{ translation_text: string }, [number]>(
      'SELECT translation_text FROM translations WHERE id = ? LIMIT 1',
    )
    .get(video.translation_row_id);
  const verse = corpus
    .query<{ iast: string | null; devanagari: string | null }, [string, number, number]>(
      'SELECT iast, devanagari FROM verses WHERE text_id = ? AND chapter = ? AND verse_num = ? LIMIT 1',
    )
    .get(video.text_id, video.chapter, video.verse_num);
  const slug = text?.slug ?? video.text_id;
  return {
    textTitle: text?.title_iast || text?.title_en || video.text_id,
    translation: tr?.translation_text ?? '',
    canonicalUrl: `${CANONICAL_BASE}/${slug}/${video.chapter}/${video.verse_num}`,
    iast: verse?.iast ?? '',
    devanagari: verse?.devanagari ?? '',
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 1000;

  const db = getVideosDb();
  const uploaded = listByStatus(db, 'uploaded', limit).filter((r) => r.youtube_video_id);
  log(STAGE, 'uploaded videos to update', { n: uploaded.length, dryRun });
  if (uploaded.length === 0) return;

  // OAuth client (shared across the batch).
  // biome-ignore lint/suspicious/noExplicitAny: dynamic googleapis shape
  let youtube: any = null;
  if (!isMockAll()) {
    const oauth = getYoutubeOAuth();
    const mod = await import('googleapis' as string).catch((e) => {
      throw new Error(`googleapis not installed: ${scrubError(e)}`);
    });
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import shape
    const { google } = mod as any;
    const oauth2 = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret);
    oauth2.setCredentials({ refresh_token: oauth.refreshToken });
    youtube = google.youtube({ version: 'v3', auth: oauth2 });
  }

  const today = new Date().toISOString().slice(0, 10);
  let updated = 0;
  for (const v of uploaded) {
    const m = resolveMeta(v);
    const meta = buildUploadMetadata({
      textTitle: m.textTitle,
      chapter: v.chapter,
      verseNum: v.verse_num,
      lang: v.lang,
      translation: m.translation,
      canonicalUrl: m.canonicalUrl,
      iast: m.iast,
      devanagari: m.devanagari,
    });
    if (dryRun) {
      log(STAGE, 'would update', { yt: v.youtube_video_id, title: meta.snippet.title });
      continue;
    }
    try {
      if (!isMockAll()) {
        await youtube.videos.update({
          part: ['snippet'],
          requestBody: {
            id: v.youtube_video_id,
            snippet: {
              title: meta.snippet.title,
              description: meta.snippet.description,
              tags: meta.snippet.tags,
              categoryId: CATEGORY_ID,
              defaultLanguage: meta.snippet.defaultLanguage,
              defaultAudioLanguage: meta.snippet.defaultAudioLanguage,
            },
          },
        });
      }
      addQuotaUnits(db, v.channel_handle, today, UNITS_PER_UPDATE, 0);
      updated++;
      log(STAGE, 'updated', { yt: v.youtube_video_id, lang: v.lang, ref: `${v.chapter}.${v.verse_num}` });
    } catch (e) {
      log(STAGE, 'update FAILED', { yt: v.youtube_video_id, error: scrubError(e).slice(0, 160) });
    }
  }
  log(STAGE, 'done', { updated, units: updated * UNITS_PER_UPDATE });
}

main().catch((e) => {
  log(STAGE, 'FAILED', { error: String(e?.message ?? e) });
  process.exit(1);
});
