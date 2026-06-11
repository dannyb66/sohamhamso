/**
 * render-queue-chapters.test.ts
 *
 * Queue/failure correctness for scripts/youtube-render-chapters.ts
 * (pure pick/classify functions, exported for testability):
 *   - pickChapterQueue picks ONLY format='chapter' rows (a chapter cron
 *     must never burn 90-min slots on shorts, and vice versa)
 *   - failed rows re-enter the queue only with retry budget left AND
 *     last_error_phase != 'upload' (upload failures ≠ re-render)
 *   - reachedMaxRetry / exitCodeForBatch drive the non-zero exit that
 *     makes the workflow's if:failure() issue step fire.
 */
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_RETRY,
  exitCodeForBatch,
  isRetryableFailedChapter,
  pickChapterQueue,
  reachedMaxRetry,
  reproCommand,
} from '../../../scripts/youtube-render-chapters';
import { insertPending, updateVideoStatus } from '../../../src/lib/videos-db';
import { SIVA_1_1_NEW, buildTempDb, seedChapterCorpus, seedChapterVideo } from './_db-helpers';

let db: Database;
beforeEach(() => {
  db = buildTempDb();
  seedChapterCorpus(db); // spanda-karikas ch1, translation rows 2..4
});
afterEach(() => {
  db.close();
});

describe('pickChapterQueue — format filter', () => {
  it('picks pending chapter rows and NEVER pending shorts', () => {
    const shortId = insertPending(db, SIVA_1_1_NEW); // format defaults to 'short'
    const chapterId = seedChapterVideo(db, { translation_row_id: 2 });

    const queue = pickChapterQueue(db, 10);
    expect(queue.map((r) => r.id)).toEqual([chapterId]);
    expect(queue.map((r) => r.id)).not.toContain(shortId);
    expect(queue[0].format).toBe('chapter');
    expect(queue[0].verse_num).toBe(0);
  });

  it('respects the limit (chapter crons run --limit=2)', () => {
    seedChapterCorpus(db, { chapter: 2 });
    seedChapterCorpus(db, { chapter: 3 });
    seedChapterVideo(db, { chapter: 1, translation_row_id: 2 });
    seedChapterVideo(db, { chapter: 2, translation_row_id: 2, translation_md5: 'md5-ch2' });
    seedChapterVideo(db, { chapter: 3, translation_row_id: 2, translation_md5: 'md5-ch3' });
    expect(pickChapterQueue(db, 2)).toHaveLength(2);
  });
});

describe('pickChapterQueue — failed-with-retry-budget', () => {
  it('includes a failed chapter row with budget left (render phase)', () => {
    const id = seedChapterVideo(db, { translation_row_id: 2 });
    updateVideoStatus(db, id, 'failed', { retry_count: 1, last_error_phase: 'render' });

    const queue = pickChapterQueue(db, 10);
    expect(queue.map((r) => r.id)).toContain(id);
  });

  it("EXCLUDES failed rows with last_error_phase='upload' (R2 mp4 is fine — no 90-min re-render)", () => {
    const id = seedChapterVideo(db, { translation_row_id: 2 });
    updateVideoStatus(db, id, 'failed', { retry_count: 1, last_error_phase: 'upload' });

    expect(pickChapterQueue(db, 10)).toHaveLength(0);
  });

  it('excludes failed rows that exhausted MAX_RETRY', () => {
    const id = seedChapterVideo(db, { translation_row_id: 2 });
    updateVideoStatus(db, id, 'failed', { retry_count: MAX_RETRY, last_error_phase: 'render' });

    expect(pickChapterQueue(db, 10)).toHaveLength(0);
  });

  it('orders pending before failed-retry', () => {
    const failedId = seedChapterVideo(db, { translation_row_id: 2, translation_md5: 'md5-a' });
    updateVideoStatus(db, failedId, 'failed', { retry_count: 1, last_error_phase: 'render' });
    const pendingId = seedChapterVideo(db, { translation_row_id: 2, translation_md5: 'md5-b' });

    expect(pickChapterQueue(db, 10).map((r) => r.id)).toEqual([pendingId, failedId]);
  });
});

describe('isRetryableFailedChapter (pure)', () => {
  it('retryable: budget left + non-upload phase', () => {
    expect(isRetryableFailedChapter({ retry_count: 2, last_error_phase: 'render' })).toBe(true);
    expect(isRetryableFailedChapter({ retry_count: null, last_error_phase: 'probe' })).toBe(true);
  });

  it('not retryable: upload phase, regardless of budget', () => {
    expect(isRetryableFailedChapter({ retry_count: 0, last_error_phase: 'upload' })).toBe(false);
  });

  it('not retryable: budget exhausted', () => {
    expect(isRetryableFailedChapter({ retry_count: MAX_RETRY, last_error_phase: 'render' })).toBe(
      false,
    );
  });
});

describe('MAX_RETRY exit-code logic (pure)', () => {
  it('reachedMaxRetry flips at MAX_RETRY', () => {
    expect(reachedMaxRetry(MAX_RETRY - 1)).toBe(false);
    expect(reachedMaxRetry(MAX_RETRY)).toBe(true);
    expect(reachedMaxRetry(MAX_RETRY + 1)).toBe(true);
    expect(reachedMaxRetry(null)).toBe(false);
  });

  it('exitCodeForBatch is non-zero IFF a row exhausted its budget (fires the failure issue)', () => {
    expect(exitCodeForBatch(0)).toBe(0);
    expect(exitCodeForBatch(1)).toBe(1);
    expect(exitCodeForBatch(3)).toBe(1);
  });

  it('reproCommand names the exact local debugging invocation', () => {
    expect(reproCommand(42)).toBe(
      'bun scripts/youtube-render-chapters.ts --video-id=42 --keep-workdir',
    );
  });
});
