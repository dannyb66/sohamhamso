/**
 * pipeline/youtube/eligibility.ts
 *
 * Pure gates deciding whether a verse/lang is allowed into the pipeline:
 *   - `meetsTranslationFloor` — translation status >= the text's
 *     `min_translation_status` floor (no draft translations, per plan).
 *   - `isYoutubeEligible` — the text's `youtube_eligible` flag in config.
 *
 * Import-light: only the config types. Unit-tested separately.
 */

import type { YoutubeConfig } from './config';

/** Ordinal ranking of translation statuses (higher = more reviewed). */
export const STATUS_ORDER: Record<'draft' | 'reviewed' | 'published', number> = {
  draft: 0,
  reviewed: 1,
  published: 2,
};

/**
 * True if `status` is at or above the `floor`. Unknown statuses rank below
 * `draft` (i.e. never clear any floor); an unknown/empty floor defaults to
 * the `reviewed` gate (no drafts).
 */
export function meetsTranslationFloor(status: string, floor: string): boolean {
  const s = STATUS_ORDER[status as keyof typeof STATUS_ORDER];
  if (s === undefined) return false;
  const f = STATUS_ORDER[floor as keyof typeof STATUS_ORDER] ?? STATUS_ORDER.reviewed;
  return s >= f;
}

/** True if the text slug is marked `youtube_eligible: true` in config. */
export function isYoutubeEligible(cfg: YoutubeConfig, slug: string): boolean {
  const t = cfg.texts[slug];
  return Boolean(t?.youtube_eligible);
}
