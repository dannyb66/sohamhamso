/**
 * pipeline/youtube/config.ts
 *
 * Zod-validated loader for `data/youtube-config.yaml`. Mirrors the
 * validation style of `src/lib/seo/corpus-schema.ts` (zod v3) and the
 * yaml-load style of `pipeline/ingest/ingest.ts` (`js-yaml`).
 *
 * Style routes off text SLUG -> preset (kula is config-only; see the
 * reconciled plan — there is no kula/school driver in the corpus/DB).
 *
 * Forbidden-color enforcement: a color is forbidden if it appears in
 * `forbidden_colors` OR sits within ±15% RGB distance of saffron
 * (#FF9933), the politically-coded flag color.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load as yamlLoad } from 'js-yaml';
import * as z from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Saffron-orange (BJP / Hindu-nationalist flag). ±15% range forbidden. */
export const SAFFRON_HEX = '#FF9933';

/** Default config path, repo-relative to cwd (the project root). */
const DEFAULT_CONFIG_PATH = 'data/youtube-config.yaml';

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const HexColor = z.string().trim().regex(HEX_RE, 'must be a 6-digit hex color like #0E1B2E');

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

export const StylePresetSchema = z
  .object({
    bg: HexColor,
    accent: HexColor,
    text: HexColor,
    headline_font: z.string().trim().min(1),
    body_font: z.string().trim().min(1),
    devanagari_font: z.string().trim().min(1),
    footer_line: z.string().trim().min(1),
    ornament: z.string().trim().min(1).default('none'),
  })
  .strict();

export const TextConfigSchema = z
  .object({
    kula: z.string().trim().min(1),
    style_preset: z.string().trim().min(1),
    youtube_eligible: z.boolean(),
    min_translation_status: z.enum(['draft', 'reviewed', 'published']).optional(),
    reason: z.string().trim().min(1).optional(),
  })
  .strict();

export const VoiceConfigSchema = z
  .object({
    provider: z.string().trim().min(1),
    voice_id: z.string().trim().min(1),
  })
  .strict();

export const DefaultsSchema = z
  .object({
    channel_handle: z.string().trim().min(1),
    visibility: z.enum(['unlisted', 'public', 'private']),
    fps: z.number().int().positive(),
    duration_s: z.number().positive(),
    /**
     * Shorts narration speed (Google TTS speakingRate, 0.25–4.0; 1.0 = normal).
     * 0.75 = slower/clearer audio. Shorts-only — chapters stay at 1.0.
     * Optional; omitted/undefined → buildTtsRequest emits no field → 1.0.
     */
    speaking_rate: z.number().min(0.25).max(4).optional(),
  })
  .strict();

/**
 * Chapter-format (16:9 full-chapter videos) block. Pacing knobs live here —
 * the M1 sample-gate loop is config-edit + re-run, never code-edit.
 * `min_translation_status` is the PER-FORMAT floor (chapters: draft, per
 * plan D1); `uploads_enabled` is the enforced upload hold until the shorts
 * measurement window closes.
 */
export const ChaptersConfigSchema = z
  .object({
    langs: z.array(z.string().trim().min(1)).min(1, 'expected at least one lang code'),
    fps: z
      .number({ invalid_type_error: 'expected positive number' })
      .int()
      .positive('expected positive number'),
    title_card_s: z
      .number({ invalid_type_error: 'expected positive number' })
      .positive('expected positive number'),
    outro_s: z
      .number({ invalid_type_error: 'expected positive number' })
      .positive('expected positive number'),
    min_translation_status: z.enum(['draft', 'reviewed', 'published']),
    uploads_enabled: z.boolean(),
    min_seg_s: z
      .number({ invalid_type_error: 'expected positive number' })
      .positive('expected positive number'),
    seg_lead_in_s: z
      .number({ invalid_type_error: 'expected positive number' })
      .positive('expected positive number'),
    seg_tail_s: z
      .number({ invalid_type_error: 'expected positive number' })
      .positive('expected positive number'),
    group_max_verses: z
      .number({ invalid_type_error: 'expected positive number' })
      .int()
      .positive('expected positive number'),
    encode: z.enum(['cbr8', 'crf18']),
  })
  .strict();

export const YoutubeConfigSchema = z
  .object({
    style_presets: z.record(z.string(), StylePresetSchema),
    texts: z.record(z.string(), TextConfigSchema),
    voices: z.record(z.string(), VoiceConfigSchema),
    defaults: DefaultsSchema,
    chapters: ChaptersConfigSchema,
    forbidden_colors: z.array(HexColor),
    forbidden_iconography: z.array(z.string().trim().min(1)),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────────────────────────────────────

export type StylePreset = z.infer<typeof StylePresetSchema>;
export type TextConfig = z.infer<typeof TextConfigSchema>;
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;
export type ChaptersConfig = z.infer<typeof ChaptersConfigSchema>;
export type YoutubeConfig = z.infer<typeof YoutubeConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render zod issues as `field.path: message` lines (one per issue) — the
 * operator sees exactly which yaml field to fix, not a raw issue dump.
 */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Load + validate the YouTube pipeline config. Throws on any schema
 * violation with field-path-bearing lines + a one-line remediation
 * (e.g. `chapters.min_seg_s: expected positive number`). `path` defaults
 * to `data/youtube-config.yaml` resolved against cwd.
 */
export function loadYoutubeConfig(path: string = DEFAULT_CONFIG_PATH): YoutubeConfig {
  const abs = resolve(process.cwd(), path);
  const raw = readFileSync(abs, 'utf8');
  const parsed = yamlLoad(raw);
  const result = YoutubeConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `invalid youtube config (${path}):\n${formatZodIssues(result.error)}\n` +
        `fix the listed field(s) in ${path}, then re-run: bun scripts/youtube-validate-config.ts`,
    );
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Accessors
// ─────────────────────────────────────────────────────────────────────────────

/** Look up a text's config by slug. Returns undefined if not present. */
export function getTextConfig(cfg: YoutubeConfig, slug: string): TextConfig | undefined {
  return cfg.texts[slug];
}

/** Typed accessor for the chapter-format block (always present post-M0). */
export function getChaptersConfig(cfg: YoutubeConfig): ChaptersConfig {
  return cfg.chapters;
}

/** Resolve a style preset by name. Throws if the preset is missing. */
export function getStylePreset(cfg: YoutubeConfig, name: string): StylePreset {
  const preset = cfg.style_presets[name];
  if (!preset) {
    throw new Error(
      `Unknown style_preset "${name}". Known: ${Object.keys(cfg.style_presets).join(', ')}`,
    );
  }
  return preset;
}

// ─────────────────────────────────────────────────────────────────────────────
// Color guards
// ─────────────────────────────────────────────────────────────────────────────

function normalizeHex(hex: string): string {
  return hex.trim().replace(/^#/, '').toLowerCase();
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex);
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Euclidean RGB distance between two hex colors expressed as a percentage
 * of the maximum possible distance (sqrt(3 * 255^2) ≈ 441.67). Returns a
 * value in [0, 100]. Invalid hex inputs yield 100 (treated as maximally
 * distant — i.e. "not a match").
 */
export function hexDistancePct(a: string, b: string): number {
  if (!HEX_RE.test(a.trim()) || !HEX_RE.test(b.trim())) return 100;
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const dist = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  const max = Math.sqrt(3 * 255 ** 2);
  return (dist / max) * 100;
}

/**
 * True if `hex` is on the config's `forbidden_colors` list (exact, case-
 * insensitive) OR within ±15% RGB distance of saffron (#FF9933).
 */
export function isForbiddenColor(cfg: YoutubeConfig, hex: string): boolean {
  const target = normalizeHex(hex);
  for (const forbidden of cfg.forbidden_colors) {
    if (normalizeHex(forbidden) === target) return true;
  }
  if (hexDistancePct(hex, SAFFRON_HEX) <= 15) return true;
  return false;
}
