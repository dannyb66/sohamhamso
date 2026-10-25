/**
 * GET /api/search?q=...&type=lexical|semantic|blended&limit=N&lang=en
 *
 * Search backend for the SearchBox island and the /search results page.
 *
 * B2 INTEGRATION: when `src/lib/search.ts` lands with
 * `{ lexicalSearch, semanticSearch, blendedSearch }`, this endpoint
 * routes to those helpers. Until then, the endpoint short-circuits with
 * an empty `data: []` and `meta.note: "search-stub"` so the route
 * doesn't block B9/B10 from rendering cleanly.
 *
 * Validation:
 *   • q: required, non-empty after trim, ≤500 chars
 *   • type: defaults to "lexical"; one of lexical|semantic|blended
 *   • limit: 1..50, defaults to 8
 *   • lang: defaults to "en"
 *
 * Returns: `{ data: VerseHit[], meta: { count, type, took_ms, note? } }`
 * 30-second `Cache-Control` on successful responses; no cache on errors.
 *
 * Astro is configured `output: 'static'` — we opt this route OUT of
 * prerender so it runs as a server endpoint at request time. Static
 * builds will need an adapter wired up; until then `astro dev` serves
 * it correctly.
 */

import type { APIRoute } from 'astro';
import { staticLexicalSearch } from '../../lib/static-search';

export const prerender = false;

// VerseHit remains the public response type; runtime reads come only from the
// generated static index so this endpoint has no database dependency.
export type { VerseHit } from '../../lib/search-types';

type SearchType = 'lexical' | 'semantic' | 'blended';

// ─── Response helpers ─────────────────────────────────────────────────
function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

function err(message: string, status = 400): Response {
  return json(
    { data: [], meta: { count: 0, took_ms: 0 }, error: message },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

// ─── GET ──────────────────────────────────────────────────────────────
export const GET: APIRoute = async ({ url, locals }) => {
  const t0 = performance.now();

  const qRaw = (url.searchParams.get('q') ?? '').trim();
  if (!qRaw) return err("Query 'q' is required.");
  if (qRaw.length > 500) return err('Query too long (max 500 chars).');

  const typeRaw = (url.searchParams.get('type') ?? 'lexical').toLowerCase();
  const type: SearchType = typeRaw === 'semantic' || typeRaw === 'blended' ? typeRaw : 'lexical';

  const limitRaw = Number(url.searchParams.get('limit') ?? '8');
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 8;

  const lang = (url.searchParams.get('lang') ?? 'en').toLowerCase();

  const runtime = (
    locals as
      | {
          runtime?: { env?: { ASSETS?: { fetch: (request: Request) => Promise<Response> } } };
        }
      | undefined
  )?.runtime;
  const staticResults = await staticLexicalSearch(qRaw, lang, limit, {
    assets: runtime?.env?.ASSETS,
    baseUrl: url,
  });
  if (staticResults === null) return err('Search index unavailable.', 503);

  const took_ms = Math.round(performance.now() - t0);
  return json(
    {
      data: staticResults,
      meta: {
        count: staticResults.length,
        type: 'lexical',
        took_ms,
        note: type === 'lexical' ? 'static-index' : `static-index-${type}-fallback`,
      },
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=10, s-maxage=3600',
      },
    },
  );
};

// Reject other methods explicitly so the route's surface is honest.
export const POST: APIRoute = () => err('GET only.', 405);
