import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..', '..');
let handleLemmaOgRequest: typeof import('../../functions/og/_shared').handleLemmaOgRequest;
let handleVerseOgRequest: typeof import('../../functions/og/_shared').handleVerseOgRequest;

beforeAll(async () => {
  ({ handleLemmaOgRequest, handleVerseOgRequest } = await import('../../functions/og/_shared'));
});

describe('OG function rendering', () => {
  it('renders verse OG success responses as PNG', async () => {
    const response = await handleVerseOgRequest(
      makeContext('https://sohamhamso.org/og/trika/siva-sutras/1/1?lang=ta'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-OG-Format')).toBe('png');
    expect(response.headers.get('X-OG-Renderer')).toBe('resvg-wasm');
    expect(response.headers.get('X-OG-Fallback')).toBeNull();

    const dimensions = readPngDimensions(new Uint8Array(await response.arrayBuffer()));
    expect(dimensions).toEqual({ width: 1200, height: 630 });
  });

  it('renders lemma OG success responses as PNG', async () => {
    const response = await handleLemmaOgRequest(
      makeContext('https://sohamhamso.org/og/lemma/sivah?lang=ta'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('X-OG-Format')).toBe('png');
    expect(response.headers.get('X-OG-Renderer')).toBe('resvg-wasm');
    expect(response.headers.get('X-OG-Fallback')).toBeNull();

    const dimensions = readPngDimensions(new Uint8Array(await response.arrayBuffer()));
    expect(dimensions).toEqual({ width: 1200, height: 630 });
  });
});

function makeContext(url: string): import('../../functions/og/_shared').OgFunctionContext {
  return {
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: async (input) => {
          const requestUrl =
            input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
          const root = requestUrl.pathname.startsWith('/_data/') ? 'dist' : 'public';
          const assetPath = resolve(ROOT, root, requestUrl.pathname.replace(/^\//, ''));
          if (!existsSync(assetPath)) return new Response('Not found', { status: 404 });
          return new Response(readFileSync(assetPath), {
            status: 200,
            headers: {
              'Content-Type': mimeTypeForPath(assetPath),
            },
          });
        },
      },
    },
    waitUntil: () => {},
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.ttf') return 'font/ttf';
  if (extension === '.ttc') return 'font/collection';
  if (extension === '.wasm') return 'application/wasm';
  return 'application/octet-stream';
}

function readPngDimensions(buffer: Uint8Array): { height: number; width: number } {
  return {
    width: Buffer.from(buffer).readUInt32BE(16),
    height: Buffer.from(buffer).readUInt32BE(20),
  };
}
