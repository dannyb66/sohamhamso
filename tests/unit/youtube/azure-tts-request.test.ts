/**
 * azure-tts-request.test.ts
 *
 * Pure-builder tests for the Azure Speech REST synthesis request used by the
 * or-IN (Odia) and as-IN (Assamese) narration path. Asserts the SSML shape,
 * voice name, language, prosody-rate mapping, the mp3 output-format header,
 * the region-templated endpoint, and XML escaping of translation text.
 *
 * These run with no secrets and no network (the subscription key is injected
 * by the caller, never by the builder).
 */
import { describe, expect, it } from 'vitest';
import {
  AZURE_OUTPUT_FORMAT,
  buildAzureTtsRequest,
  escapeXml,
  speakingRateToSsmlRate,
} from '../../../pipeline/youtube/tts-request';

describe('buildAzureTtsRequest', () => {
  const req = buildAzureTtsRequest(
    'Consciousness is the Self.',
    'or-IN-SubhasiniNeural',
    'or-IN',
    undefined,
    'centralindia',
  );

  it('targets the region-templated cognitiveservices/v1 endpoint', () => {
    expect(req.url).toBe('https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1');
  });

  it('requests an mp3 output format via X-Microsoft-OutputFormat', () => {
    expect(req.headers['X-Microsoft-OutputFormat']).toBe(AZURE_OUTPUT_FORMAT);
    expect(req.headers['X-Microsoft-OutputFormat']).toContain('mp3');
  });

  it('sets the SSML content-type', () => {
    expect(req.headers['Content-Type']).toBe('application/ssml+xml');
  });

  it('NEVER embeds the subscription key (caller injects it)', () => {
    expect(JSON.stringify(req.headers)).not.toMatch(/Ocp-Apim-Subscription-Key/i);
  });

  it('wraps the text in a <speak><voice> SSML document', () => {
    expect(req.ssml).toContain('<speak');
    expect(req.ssml).toContain('xmlns="http://www.w3.org/2001/10/synthesis"');
    expect(req.ssml).toContain('</speak>');
    expect(req.ssml).toContain('<voice name="or-IN-SubhasiniNeural">');
    expect(req.ssml).toContain('Consciousness is the Self.');
  });

  it('sets xml:lang to the locale', () => {
    expect(req.ssml).toContain('xml:lang="or-IN"');
  });

  it('omits a <prosody> wrapper at normal rate (1.0 / undefined)', () => {
    expect(req.ssml).not.toContain('<prosody');
    const r1 = buildAzureTtsRequest('hi', 'or-IN-SubhasiniNeural', 'or-IN', 1);
    expect(r1.ssml).not.toContain('<prosody');
  });

  it('defaults the region to eastus when none is given', () => {
    const r = buildAzureTtsRequest('hi', 'as-IN-YashicaNeural', 'as-IN');
    expect(r.url).toBe('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1');
  });

  it('uses the requested Assamese voice + locale', () => {
    const r = buildAzureTtsRequest('Namaste', 'as-IN-YashicaNeural', 'as-IN');
    expect(r.ssml).toContain('<voice name="as-IN-YashicaNeural">');
    expect(r.ssml).toContain('xml:lang="as-IN"');
  });
});

describe('speakingRateToSsmlRate (Google speakingRate → SSML prosody rate)', () => {
  it('returns undefined for normal / undefined rate (byte-stable)', () => {
    expect(speakingRateToSsmlRate(undefined)).toBeUndefined();
    expect(speakingRateToSsmlRate(1)).toBeUndefined();
  });

  it('maps 0.75 → -25%', () => {
    expect(speakingRateToSsmlRate(0.75)).toBe('-25%');
  });

  it('maps 1.2 → +20%', () => {
    expect(speakingRateToSsmlRate(1.2)).toBe('+20%');
  });

  it('maps 0.9 → -10% (contemplative chapter read)', () => {
    expect(speakingRateToSsmlRate(0.9)).toBe('-10%');
  });
});

describe('buildAzureTtsRequest prosody wrapper', () => {
  it('wraps text in <prosody rate> when a non-1.0 speakingRate is given', () => {
    const r = buildAzureTtsRequest('slow read', 'or-IN-SubhasiniNeural', 'or-IN', 0.75);
    expect(r.ssml).toContain('<prosody rate="-25%">slow read</prosody>');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML-significant characters', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('produces SSML that cannot be broken by ampersands in the text', () => {
    const r = buildAzureTtsRequest('Siva & Sakti', 'or-IN-SubhasiniNeural', 'or-IN');
    expect(r.ssml).toContain('Siva &amp; Sakti');
    expect(r.ssml).not.toContain('Siva & Sakti');
  });
});
