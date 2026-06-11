/**
 * tts-request-builder.test.ts
 *
 * `buildTtsRequest` shapes a Google Cloud TTS `synthesizeSpeech` body:
 * plain text input (no SSML in Phase 1), the chosen voice, and MP3 output.
 */
import { describe, expect, it } from 'vitest';
import { buildTtsRequest } from '../../../pipeline/youtube/tts-request';

describe('buildTtsRequest', () => {
  const req = buildTtsRequest('Consciousness is the Self.', 'en-US-Studio-O', 'en-US');

  it('puts the translation text in input.text', () => {
    expect(req.input.text).toBe('Consciousness is the Self.');
  });

  it('sets the voice name', () => {
    expect(req.voice.name).toBe('en-US-Studio-O');
  });

  it('sets the voice languageCode', () => {
    expect(req.voice.languageCode).toBe('en-US');
  });

  it('requests MP3 audio encoding', () => {
    expect(req.audioConfig.audioEncoding).toBe('MP3');
  });

  it('does not embed SSML markup for plain English text', () => {
    expect(JSON.stringify(req)).not.toContain('<speak>');
  });
});
