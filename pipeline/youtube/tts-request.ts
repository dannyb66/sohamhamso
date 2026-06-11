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
  audioConfig: { audioEncoding: 'MP3' };
}

/** Build the synthesize request for a translation read aloud. */
export function buildTtsRequest(text: string, voiceId: string, langCode: string): TtsRequest {
  return {
    input: { text },
    voice: { languageCode: langCode, name: voiceId },
    audioConfig: { audioEncoding: 'MP3' },
  };
}
