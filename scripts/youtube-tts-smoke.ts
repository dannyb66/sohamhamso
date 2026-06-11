#!/usr/bin/env bun
/**
 * scripts/youtube-tts-smoke.ts
 *
 * 3-voice listen test for Siva Sutra 1.1's English translation
 * ("Consciousness is the Self."). Lets the operator pick a narration voice by
 * ear before locking it in `data/youtube-config.yaml`.
 *
 * Voices: en-US-Studio-O, en-US-Studio-Q, en-US-Neural2-C.
 * Real synthesis goes through Google Cloud TTS and writes
 *   /tmp/tts-smoke-<voice>.mp3
 *
 * Zero-secret path: `MOCK_ALL=true` writes a real (silent) WAV per voice via
 * an inline PCM WAV header generator — no Google call, no ffmpeg, exits 0.
 *
 * CLI (matches scripts/seo-verify-phase0.ts arg style):
 *   --help        print usage and exit 0
 *   --json        machine-readable report on stdout
 *   --dry-run     plan only; no network, no files written
 *
 * Env:
 *   MOCK_ALL=true  canned silent WAV instead of calling Google (zero secret)
 *
 * Creds are read ONLY via pipeline/youtube/secrets.ts::getGoogleTtsCreds.
 * Logs via pipeline/youtube/log.ts::log ([youtube:tts-smoke] convention).
 *
 * NOTE: `@google-cloud/text-to-speech` is installed later by the orchestrator.
 * The real call is behind a dynamic import + try/catch so this file always
 * parses and `--dry-run` / `MOCK_ALL=true` work with zero deps.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log, logError } from '../pipeline/youtube/log';
import { getGoogleTtsCreds } from '../pipeline/youtube/secrets';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STAGE = 'tts-smoke';
const TEXT = 'Consciousness is the Self.'; // Siva Sutra 1.1 English translation
const REFERENCE = 'Śiva Sūtra 1.1';
const VOICES = ['en-US-Studio-O', 'en-US-Studio-Q', 'en-US-Neural2-C'] as const;
const LANGUAGE_CODE = 'en-US';
const OUT_DIR = '/tmp';
// WaveNet/Studio pricing ~ $0.000016 per character (Standard tier comparator).
const COST_PER_CHAR_USD = 0.000016;

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing (minimal — no external dep)
// ─────────────────────────────────────────────────────────────────────────────

type CliArgs = { help: boolean; json: boolean; dryRun: boolean };

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { help: false, json: false, dryRun: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--json') out.json = true;
    else if (arg === '--dry-run') out.dryRun = true;
  }
  return out;
}

const USAGE = `youtube-tts-smoke — 3-voice listen test for Siva Sutra 1.1

Usage:
  bun scripts/youtube-tts-smoke.ts [--json] [--dry-run] [--help]

Flags:
  --help        Show this help and exit
  --json        Emit a machine-readable JSON report
  --dry-run     Plan only — no network calls, no files written

Env:
  MOCK_ALL=true  Write a canned silent WAV per voice (zero-secret, no Google)

Synthesizes "${TEXT}" in: ${VOICES.join(', ')}
Real output: ${OUT_DIR}/tts-smoke-<voice>.mp3
Mock output: ${OUT_DIR}/tts-smoke-<voice>.wav
`;

// ─────────────────────────────────────────────────────────────────────────────
// Inline silent PCM WAV generator (no ffmpeg, no deps)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a valid mono 16-bit PCM WAV of `seconds` of silence.
 * RIFF/WAVE header + all-zero data chunk.
 */
function silentWav(seconds: number, sampleRate = 24000): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.max(1, Math.floor(seconds * sampleRate));
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize); // data is already zero-filled

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4); // chunk size
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Real Google Cloud TTS synthesis (guarded behind dynamic import)
// ─────────────────────────────────────────────────────────────────────────────

type VoiceResult = {
  voice: string;
  outPath: string;
  bytes: number;
  mode: 'real' | 'mock' | 'dry-run';
};

/**
 * Synthesize one line through Google Cloud TTS. The client package is imported
 * dynamically so this file parses with zero deps; failures bubble up to the
 * caller, which logs and exits non-zero.
 */
async function synthReal(voice: string): Promise<VoiceResult> {
  const creds = getGoogleTtsCreds(); // chokepoint; hard-fails in prod if absent

  // Dynamic import: resolves only after `bun add @google-cloud/text-to-speech`.
  const mod = await import('@google-cloud/text-to-speech' as string);
  const TextToSpeechClient =
    (mod as { TextToSpeechClient?: unknown }).TextToSpeechClient ??
    (mod as { default?: { TextToSpeechClient?: unknown } }).default?.TextToSpeechClient;
  if (typeof TextToSpeechClient !== 'function') {
    throw new Error('TextToSpeechClient not found in @google-cloud/text-to-speech');
  }

  // Prefer inline service-account JSON when present; otherwise ADC.
  const clientOpts: Record<string, unknown> = {};
  if (creds.credentialsJson) {
    clientOpts.credentials = JSON.parse(creds.credentialsJson);
  }

  // biome-ignore lint/suspicious/noExplicitAny: dynamic client shape
  const client = new (TextToSpeechClient as any)(clientOpts);
  // biome-ignore lint/suspicious/noExplicitAny: dynamic client shape
  const [response] = await (client as any).synthesizeSpeech({
    input: { text: TEXT },
    voice: { languageCode: LANGUAGE_CODE, name: voice },
    audioConfig: { audioEncoding: 'MP3' },
  });

  const audio = response?.audioContent;
  if (!audio) throw new Error(`empty audioContent for voice ${voice}`);
  const outPath = resolve(OUT_DIR, `tts-smoke-${voice}.mp3`);
  const buf = Buffer.isBuffer(audio) ? audio : Buffer.from(audio);
  writeFileSync(outPath, buf);
  return { voice, outPath, bytes: buf.length, mode: 'real' };
}

/** Write a real silent WAV for the voice (zero-secret mock path). */
function synthMock(voice: string): VoiceResult {
  const outPath = resolve(OUT_DIR, `tts-smoke-${voice}.wav`);
  const buf = silentWav(2.5);
  writeFileSync(outPath, buf);
  return { voice, outPath, bytes: buf.length, mode: 'mock' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const mockAll = process.env.MOCK_ALL === 'true';
  const charCount = TEXT.length;
  const costUsd = charCount * COST_PER_CHAR_USD * VOICES.length;
  const mode: VoiceResult['mode'] = args.dryRun ? 'dry-run' : mockAll ? 'mock' : 'real';

  log(STAGE, 'starting', {
    reference: REFERENCE,
    chars: charCount,
    voices: VOICES.length,
    mode,
    estCostUsd: costUsd.toFixed(6),
  });

  const results: VoiceResult[] = [];

  for (const voice of VOICES) {
    if (args.dryRun) {
      const ext = mockAll ? 'wav' : 'mp3';
      const outPath = resolve(OUT_DIR, `tts-smoke-${voice}.${ext}`);
      log(STAGE, 'plan', { voice, outPath });
      results.push({ voice, outPath, bytes: 0, mode: 'dry-run' });
      continue;
    }

    if (mockAll) {
      const r = synthMock(voice);
      log(STAGE, 'wrote mock wav', { voice, outPath: r.outPath, bytes: r.bytes });
      results.push(r);
      continue;
    }

    const r = await synthReal(voice);
    log(STAGE, 'wrote mp3', { voice, outPath: r.outPath, bytes: r.bytes });
    results.push(r);
  }

  log(STAGE, 'done', {
    mode,
    files: results.length,
    estCostUsd: mockAll || args.dryRun ? '0.000000' : costUsd.toFixed(6),
  });

  if (args.json) {
    const report = {
      stage: STAGE,
      reference: REFERENCE,
      text: TEXT,
      chars: charCount,
      mode,
      estCostUsd: mockAll || args.dryRun ? 0 : Number(costUsd.toFixed(6)),
      costPerCharUsd: COST_PER_CHAR_USD,
      voices: VOICES,
      results: results.map((r) => ({
        voice: r.voice,
        outPath: r.outPath,
        bytes: r.bytes,
      })),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `\nEstimate: ${charCount} chars × ${VOICES.length} voices × $${COST_PER_CHAR_USD}/char ` +
        `≈ $${(mockAll || args.dryRun ? 0 : costUsd).toFixed(6)} (${mode})\n`,
    );
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logError(STAGE, err);
    process.exit(1);
  });
