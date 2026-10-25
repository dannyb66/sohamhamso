import type { APIRoute } from 'astro';
import type { LangCode } from '../../../lib/reading-modes';
import { runStaticCorpusHealthCheck } from '../../../lib/static-corpus-health';

export const prerender = false;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export const GET: APIRoute = async ({ url, locals }) => {
  const sample: Record<string, string | number> = {};
  const tradition = url.searchParams.get('tradition');
  const textSlug = url.searchParams.get('text');
  const chapter = url.searchParams.get('chapter');
  const verse = url.searchParams.get('verse');
  const lang = url.searchParams.get('lang');

  if (tradition !== null) sample.tradition = tradition;
  if (textSlug !== null) sample.textSlug = textSlug;
  if (chapter !== null) sample.chapter = Number.parseInt(chapter, 10);
  if (verse !== null) sample.verse = Number.parseInt(verse, 10);
  if (lang !== null) sample.lang = lang;

  const assets = (
    locals as { runtime?: { env?: { ASSETS?: { fetch: typeof fetch } } } } | undefined
  )?.runtime?.env?.ASSETS;
  if (!assets) {
    return json(
      { ok: false, backend: 'static-assets', message: 'Static ASSETS binding is unavailable.' },
      { status: 503 },
    );
  }

  const report = await runStaticCorpusHealthCheck({
    assets,
    baseUrl: url,
    sample: sample as Partial<{
      tradition: string;
      textSlug: string;
      chapter: number;
      verse: number;
      lang: LangCode;
    }>,
  });

  return json(report, { status: report.ok ? 200 : 503 });
};
