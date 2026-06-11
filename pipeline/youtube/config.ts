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
  })
  .strict();

export const YoutubeConfigSchema = z
  .object({
    style_presets: z.record(z.string(), StylePresetSchema),
    texts: z.record(z.string(), TextConfigSchema),
    voices: z.record(z.string(), VoiceConfigSchema),
    defaults: DefaultsSchema,
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
export type YoutubeConfig = z.infer<typeof YoutubeConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load + validate the YouTube pipeline config. Throws (Zod error) on
 * any schema violation. `path` defaults to `data/youtube-config.yaml`
 * resolved against cwd.
 */
export function loadYoutubeConfig(path: string = DEFAULT_CONFIG_PATH): YoutubeConfig {
  const abs = resolve(process.cwd(), path);
  const raw = readFileSync(abs, 'utf8');
  const parsed = yamlLoad(raw);
  return YoutubeConfigSchema.parse(parsed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Accessors
// ─────────────────────────────────────────────────────────────────────────────

/** Look up a text's config by slug. Returns undefined if not present. */
export function getTextConfig(cfg: YoutubeConfig, slug: string): TextConfig | undefined {
  return cfg.texts[slug];
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
