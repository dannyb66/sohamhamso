/**
 * pipeline/youtube/tts-request.ts
 *
 * Pure builder for a Google Cloud TTS `synthesizeSpeech` request body.
 * No SSML in Phase 1 (English plain text). MP3 output.
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
