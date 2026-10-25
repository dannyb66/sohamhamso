import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

describe('Cloudflare preview-image bindings', () => {
  it('renders endpoint images without fetching or compiling a WASM asset at request time', async () => {
    const { handleVerseOgRequest, handleLemmaOgRequest } = await import(
      '../../functions/og/_shared'
    );
    const module = new WebAssembly.Module(
      readFileSync(resolve(ROOT, 'public/og-runtime/resvg-index_bg.wasm')),
    );
    let wasmFetches = 0;
    const assets = {
      fetch: async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.pathname.endsWith('.wasm')) {
          wasmFetches += 1;
          throw new Error('Request-time WASM compilation is forbidden in the Worker.');
        }
        const directory = url.pathname.startsWith('/_data/') ? 'dist' : 'public';
        const path = resolve(ROOT, directory, url.pathname.replace(/^\//, ''));
        return existsSync(path)
          ? new Response(readFileSync(path))
          : new Response('Not found', { status: 404 });
      },
    };
    for (const [handler, path] of [
      [handleVerseOgRequest, '/og/trika/spanda-karikas/1/1'],
      [handleLemmaOgRequest, '/og/lemma/sivah?lang=ta'],
    ] as const) {
      const response = await handler({
        request: new Request(`https://sohamhamso.org${path}`),
        env: { ASSETS: assets, RESVG_WASM: module },
        waitUntil() {},
      } as unknown as Parameters<typeof handler>[0]);
      expect(response.status).toBe(200);
      expect(
        response.headers.get('X-OG-Renderer'),
        response.headers.get('X-OG-Fallback-Reason') ?? '',
      ).toBe('resvg-wasm');
      expect(response.headers.get('X-OG-Fallback')).toBeNull();
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    }
    expect(wasmFetches).toBe(0);
  });
});
