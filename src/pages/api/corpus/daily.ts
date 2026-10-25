import type { APIRoute } from 'astro';
import { readStaticCorpusJson } from '../../../lib/static-corpus-read';

export const prerender = false;

type RuntimeAssets = { fetch: (request: Request) => Promise<Response> };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      ...(init.headers || {}),
    },
  });
}

export const GET: APIRoute = async ({ url, locals }) => {
  const assets = (locals as { runtime?: { env?: { ASSETS?: RuntimeAssets } } } | undefined)?.runtime
    ?.env?.ASSETS;
  if (!assets) {
    return json({ ok: false, message: 'Static ASSETS binding is unavailable.' }, { status: 503 });
  }

  const bundle = await readStaticCorpusJson<Record<string, unknown>>('siva-sutras/1.json', {
    assets,
    baseUrl: url,
  });
  if (!bundle) {
    return json({ ok: false, message: 'Daily corpus asset is unavailable.' }, { status: 503 });
  }

  return json(bundle);
};
