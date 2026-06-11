#!/usr/bin/env bun
import { UsageError, parseCommonArgs } from '../pipeline/youtube/cli';
/**
 * scripts/youtube-validate-config.ts
 *
 * Gate for `data/youtube-config.yaml` (run in preflight + CI). Loads +
 * Zod-validates the config, then cross-checks:
 *   - every preset's bg/accent/text passes isForbiddenColor==false
 *     (rejects saffron ±15%, magenta, purple-gold, turquoise, etc.)
 *   - every youtube_eligible:true text references a valid style_preset
 *   - forbidden_iconography is present and non-empty
 *
 * Exit 0 clean, 3 on any config/gate violation, 2 on usage error.
 * Conforms to CLI-CONVENTIONS (--help/--json).
 */
import { getStylePreset, isForbiddenColor, loadYoutubeConfig } from '../pipeline/youtube/config';
import { log } from '../pipeline/youtube/log';

const STAGE = 'config';

const USAGE = `youtube-validate-config — Zod + palette/iconography gate for data/youtube-config.yaml

Usage:
  bun scripts/youtube-validate-config.ts [--json] [--help]

Flags:
  --help   Show this help and exit 0
  --json   Emit a machine-readable JSON summary on stdout

Exit codes:
  0  config valid    2  usage error    3  config/gate violation
`;

interface Summary {
  ok: boolean;
  presetCount: number;
  textCount: number;
  eligibleCount: number;
  forbiddenColorCount: number;
  forbiddenIconographyCount: number;
  violations: string[];
}

function validate(configPath?: string): Summary {
  const violations: string[] = [];
  const cfg = loadYoutubeConfig(configPath);

  // 1. No preset uses a forbidden color in bg/accent/text.
  for (const [name, preset] of Object.entries(cfg.style_presets)) {
    for (const key of ['bg', 'accent', 'text'] as const) {
      const hex = preset[key];
      if (isForbiddenColor(cfg, hex)) {
        violations.push(`preset "${name}".${key} uses forbidden color ${hex}`);
      }
    }
  }

  // 2. Every youtube_eligible:true text references a valid style_preset.
  let eligibleCount = 0;
  for (const [slug, text] of Object.entries(cfg.texts)) {
    if (!text.youtube_eligible) continue;
    eligibleCount += 1;
    try {
      getStylePreset(cfg, text.style_preset);
    } catch {
      violations.push(
        `text "${slug}" is youtube_eligible but style_preset "${text.style_preset}" is unknown`,
      );
    }
  }

  // 3. forbidden_iconography present + non-empty.
  if (!Array.isArray(cfg.forbidden_iconography) || cfg.forbidden_iconography.length === 0) {
    violations.push('forbidden_iconography must be present and non-empty');
  }

  return {
    ok: violations.length === 0,
    presetCount: Object.keys(cfg.style_presets).length,
    textCount: Object.keys(cfg.texts).length,
    eligibleCount,
    forbiddenColorCount: cfg.forbidden_colors.length,
    forbiddenIconographyCount: cfg.forbidden_iconography.length,
    violations,
  };
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

  let summary: Summary;
  try {
    summary = validate();
  } catch (e) {
    // Zod / yaml / read errors are config failures (exit 3).
    if (args.json) {
      console.log(
        JSON.stringify({ ok: false, error: String(e instanceof Error ? e.message : e) }, null, 2),
      );
    } else {
      console.error(
        `[youtube:${STAGE}] config load/parse failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    process.exit(3);
  }

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    log(STAGE, summary.ok ? 'config valid' : 'config INVALID', {
      presets: summary.presetCount,
      texts: summary.textCount,
      eligible: summary.eligibleCount,
    });
    for (const v of summary.violations) {
      console.error(`[youtube:${STAGE}] violation: ${v}`);
    }
  }

  if (!summary.ok) process.exit(3);
}

main();
