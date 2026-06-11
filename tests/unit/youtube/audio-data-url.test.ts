/**
 * audio-data-url.test.ts
 *
 * Regression cover for the render-engine audio bug: Remotion's render server
 * only fetches assets over http(s)/staticFile, so a render-time TTS file must
 * be inlined as a base64 `data:` URL with the correct MIME. A bare path /
 * file:// URL 404s ("Can only download URLs starting with http:// or https://").
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioFileToDataUrl } from '../../../pipeline/youtube/render-engine';

const dir = mkdtempSync(join(tmpdir(), 'audio-data-url-'));

function write(name: string, bytes: number[]): string {
  const p = join(dir, name);
  writeFileSync(p, Buffer.from(bytes));
  return p;
}

describe('audioFileToDataUrl', () => {
  it('sniffs MP3 (ID3 header) → audio/mpeg', () => {
    const p = write('id3.mp3', [0x49, 0x44, 0x33, 0x04, 0x00, 0x01, 0x02]); // "ID3"
    const url = audioFileToDataUrl(p);
    expect(url).toMatch(/^data:audio\/mpeg;base64,/);
  });

  it('sniffs MP3 (MPEG frame sync 0xFFFx) → audio/mpeg', () => {
    const p = write('sync.mp3', [0xff, 0xfb, 0x90, 0x00]);
    expect(audioFileToDataUrl(p)).toMatch(/^data:audio\/mpeg;base64,/);
  });

  it('sniffs WAV (RIFF header) → audio/wav', () => {
    const p = write('riff.wav', [0x52, 0x49, 0x46, 0x46, 0x00, 0x00]); // "RIFF"
    expect(audioFileToDataUrl(p)).toMatch(/^data:audio\/wav;base64,/);
  });

  it('round-trips the bytes into the base64 payload', () => {
    const bytes = [0x49, 0x44, 0x33, 0x11, 0x22, 0x33];
    const p = write('rt.mp3', bytes);
    const url = audioFileToDataUrl(p) ?? '';
    const b64 = url.split(',')[1];
    expect(Buffer.from(b64, 'base64')).toEqual(Buffer.from(bytes));
  });

  it('returns null for a missing file (→ silent render)', () => {
    expect(audioFileToDataUrl(join(dir, 'nope.mp3'))).toBeNull();
  });

  it('returns null for an empty file', () => {
    const p = write('empty.mp3', []);
    expect(existsSync(p)).toBe(true);
    expect(audioFileToDataUrl(p)).toBeNull();
  });

  it('produces only http-free data URLs (the Remotion contract)', () => {
    const p = write('contract.mp3', [0x49, 0x44, 0x33, 0x00]);
    const url = audioFileToDataUrl(p) ?? '';
    expect(url.startsWith('data:')).toBe(true);
    expect(url).not.toMatch(/^https?:\/\//);
    expect(url).not.toMatch(/^file:\/\//);
  });
});
