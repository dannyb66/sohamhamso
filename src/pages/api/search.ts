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

export const prerender = false;

// ─── Types ────────────────────────────────────────────────────────────
export interface VerseHit {
  text_id: string;
  text_slug: string;
  text_title: string;
  tradition: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  translation_excerpt: string | null;
  score?: number;
}

type SearchType = 'lexical' | 'semantic' | 'blended';

// ─── B2 helper bridge ─────────────────────────────────────────────────
/**
 * Lazy, non-throwing dynamic import. If `src/lib/search.ts` doesn't
 * exist yet, returns null and the endpoint falls back to the stub.
 */
async function loadSearchLib(): Promise<{
  lexicalSearch?: (q: string, lang: string, limit: number) => Promise<VerseHit[]> | VerseHit[];
  semanticSearch?: (q: string, lang: string, limit: number) => Promise<VerseHit[]> | VerseHit[];
  blendedSearch?: (q: string, lang: string, limit: number) => Promise<VerseHit[]> | VerseHit[];
} | null> {
  try {
    // @ts-expect-error — may not exist until B2 lands; we handle null.
    const mod = await import('../../lib/search.ts');
    return mod as Awaited<ReturnType<typeof loadSearchLib>>;
  } catch {
    return null;
  }
}

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
export const GET: APIRoute = async ({ url }) => {
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

  const lib = await loadSearchLib();

  let data: VerseHit[] = [];
  let note: string | undefined;

  if (!lib) {
    note = 'search-stub';
  } else {
    try {
      const fn =
        type === 'blended'
          ? lib.blendedSearch
          : type === 'semantic'
            ? lib.semanticSearch
            : lib.lexicalSearch;
      if (typeof fn === 'function') {
        const out = await fn(qRaw, lang, limit);
        data = Array.isArray(out) ? out.slice(0, limit) : [];
      } else {
        note = `search-${type}-not-implemented`;
      }
    } catch (e) {
      // Don't leak internals — log to console for debugging.
      // eslint-disable-next-line no-console
      console.error('[api/search]', e);
      return err('Search failed.', 500);
    }
  }

  const took_ms = Math.round(performance.now() - t0);
  return json(
    {
      data,
      meta: {
        count: data.length,
        type,
        took_ms,
        ...(note ? { note } : {}),
      },
    },
    {
      status: 200,
      headers: {
        // 30s shared cache + brief browser cache for repeated keystrokes.
        'Cache-Control': 'public, max-age=10, s-maxage=30',
      },
    },
  );
};

// Reject other methods explicitly so the route's surface is honest.
export const POST: APIRoute = () => err('GET only.', 405);
