/**
 * pipeline/youtube/tts-request.ts
 *
 * Pure builders for the two TTS providers:
 *   - Google Cloud TTS `synthesizeSpeech` request body (`buildTtsRequest`).
 *   - Azure Speech REST SSML body + headers (`buildAzureTtsRequest`) — used
 *     for or-IN (Odia) and as-IN (Assamese), the two langs with full corpus
 *     translations but NO Google voice.
 *
 * Pure — no imports. Unit-tested separately.
 */

export interface TtsRequest {
  input: { text: string };
  voice: { languageCode: string; name: string };
  audioConfig: { audioEncoding: 'MP3'; speakingRate?: number };
}

/**
 * Build the synthesize request for a translation read aloud.
 *
 * `speakingRate` (Google TTS, 0.25–4.0; 1.0 = normal) slows or speeds the
 * narration. Omitted/1.0 → no field emitted → Google's default. Shorts pass
 * `defaults.speaking_rate` (0.75, for clearer audio); chapters omit it (1.0).
 * Studio voices honor it only partially — see scripts/youtube-render-speed-samples.
 */
export function buildTtsRequest(
  text: string,
  voiceId: string,
  langCode: string,
  speakingRate?: number,
): TtsRequest {
  return {
    input: { text },
    voice: { languageCode: langCode, name: voiceId },
    audioConfig: {
      audioEncoding: 'MP3',
      ...(speakingRate != null && speakingRate !== 1 ? { speakingRate } : {}),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Azure Speech (REST) — or-IN / as-IN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The mp3 output format requested from Azure. 24kHz mono 48kbit matches the
 * MP3 the Google path produces closely enough for the downstream data-URL sniff
 * and Remotion/ffmpeg re-encode path.
 */
export const AZURE_OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

/** Shape returned by `buildAzureTtsRequest` — everything an HTTP POST needs. */
export interface AzureTtsRequest {
  /** Full REST endpoint URL for the resource's region. */
  url: string;
  /** Request headers (NOTE: caller injects `Ocp-Apim-Subscription-Key`). */
  headers: {
    'Content-Type': 'application/ssml+xml';
    'X-Microsoft-OutputFormat': string;
    'User-Agent': string;
  };
  /** SSML request body. */
  ssml: string;
}

/** Escape XML-significant characters so translations cannot break SSML. */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Map Google-style speakingRate to an SSML prosody rate. Returns undefined for
 * 1.0/undefined so the prosody wrapper is omitted.
 */
export function speakingRateToSsmlRate(speakingRate?: number): string | undefined {
  if (speakingRate == null || speakingRate === 1) return undefined;
  const pct = Math.round((speakingRate - 1) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/**
 * Build the Azure Speech REST synthesis request. The subscription key is
 * injected by the caller, never embedded in this pure builder.
 */
export function buildAzureTtsRequest(
  text: string,
  voiceId: string,
  langCode: string,
  speakingRate?: number,
  region = 'eastus',
  outputFormat: string = AZURE_OUTPUT_FORMAT,
): AzureTtsRequest {
  const rate = speakingRateToSsmlRate(speakingRate);
  const escaped = escapeXml(text);
  const inner = rate ? `<prosody rate="${rate}">${escaped}</prosody>` : escaped;
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${langCode}"><voice name="${voiceId}">${inner}</voice></speak>`;
  return {
    url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    headers: {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': outputFormat,
      'User-Agent': 'sohamhamso-youtube-pipeline',
    },
    ssml,
  };
}
