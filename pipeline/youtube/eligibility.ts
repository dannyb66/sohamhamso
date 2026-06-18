/**
 * pipeline/youtube/eligibility.ts
 *
 * Pure gates deciding whether a verse/lang is allowed into the pipeline:
 *   - `meetsTranslationFloor` — translation status >= the text's
 *     `min_translation_status` floor (no draft translations, per plan).
 *   - `translationFloorFor` / `meetsTranslationFloorForFormat` — per-format
 *     floor resolution: shorts keep the text's floor (unchanged); chapters
 *     use the global `chapters.min_translation_status` (plan D1).
 *   - `isYoutubeEligible` — the text's `youtube_eligible` flag in config.
 *
 * Import-light: only the config types. Unit-tested separately.
 */

import type { YoutubeConfig } from './config';

/** Video formats sharing these eligibility gates. */
export type VideoFormat = 'short' | 'chapter';

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

/**
 * Resolve the translation-status floor for a (text, format) pair:
 *   - 'short' (default): the text's `min_translation_status`, falling back
 *     to 'reviewed' — byte-for-byte the pre-chapter behavior (mirrors
 *     scripts/youtube-backfill-pending.ts:154).
 *   - 'chapter': the global `chapters.min_translation_status` per-format
 *     floor ('draft' in v1; no corpus mutation, per plan D1).
 */
export function translationFloorFor(
  cfg: YoutubeConfig,
  slug: string,
  format: VideoFormat = 'short',
): 'draft' | 'reviewed' | 'published' {
  if (format === 'chapter') return cfg.chapters.min_translation_status;
  return cfg.texts[slug]?.min_translation_status ?? 'reviewed';
}

/**
 * Per-format wrapper over `meetsTranslationFloor`: gates a translation's
 * `status` against the floor resolved by `translationFloorFor`.
 */
export function meetsTranslationFloorForFormat(
  cfg: YoutubeConfig,
  slug: string,
  status: string,
  format: VideoFormat = 'short',
): boolean {
  return meetsTranslationFloor(status, translationFloorFor(cfg, slug, format));
}

/** True if the text slug is marked `youtube_eligible: true` in config. */
export function isYoutubeEligible(cfg: YoutubeConfig, slug: string): boolean {
  const t = cfg.texts[slug];
  return Boolean(t?.youtube_eligible);
}
