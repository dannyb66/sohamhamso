import { type CorpusDb, CorpusNotConfiguredError, getCorpusDb } from '../../src/lib/corpus-db';
import { FONT_ASSET_PATHS } from '../../src/lib/font-assets';
import {
  type LemmaOgPayload,
  type LemmaOgRoute,
  OG_DEFAULT_LANG,
  type OgRouteValidationError,
  type VerseOgPayload,
  type VerseOgRoute,
  buildVerseOgPayloadFromCache,
  fetchLemmaOgPayload,
  fetchVerseOgPayload,
  parseLemmaOgUrl,
  parseVerseOgUrl,
} from '../../src/lib/seo/og-payload';
import { getReadingModeByLang } from '../../src/lib/reading-modes';

const OG_SUCCESS_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const OG_FALLBACK_CACHE_CONTROL = 'public, max-age=60';
// 1500ms accommodates the libsql `/web` client's TLS handshake + first HTTP
// round-trip on a cold worker isolate (warm probes complete in ~450ms, but
// cold-start probes were blowing the previous 500ms budget — that's the
// "100% fallback in production" bug Phase 8 caught). 1500ms still leaves
// ample headroom inside the 2000ms render budget and the CF Workers
// total-CPU limits.
const OG_QUERY_TIMEOUT_MS = 1500;
const OG_RENDER_TIMEOUT_MS = 2000;
const OG_FALLBACK_ASSET_CANDIDATES = ['/og-default.png', '/og-default.svg'] as const;
const OG_RUNTIME_WASM_ASSET = '/og-runtime/resvg-index_bg.wasm';

type OgSuccessPayload = VerseOgPayload | LemmaOgPayload;
type OgSuccessRoute = VerseOgRoute | LemmaOgRoute;

let _resvgModulePromise: Promise<typeof import('@resvg/resvg-wasm')> | null = null;
let _resvgReadyPromise: Promise<typeof import('@resvg/resvg-wasm')> | null = null;
let _ogFontBuffersPromise: Promise<Uint8Array[]> | null = null;
// Module-scope memoization of the libsql `/web` import. Each `await import()`
// call pays a non-trivial chunk-load cost on a cold worker isolate (~50-200ms
// in workerd because the chunk must be parsed + linked). Without memoization
// every OG request re-paid this cost, eating the query timeout budget. We
// memoize the IMPORT (not the client) so the per-request `createClient(...)`
// — which owns the AbortSignal closure — can still happen fresh per request
// without cross-request signal contamination.
let _libsqlClientImportPromise: Promise<typeof import('@libsql/client/web')> | null = null;

export interface OgEnv {
  ASSETS: { fetch: typeof fetch };
  TURSO_CORPUS_URL?: string;
  TURSO_CORPUS_AUTH_TOKEN?: string;
  /** Pre-compiled WebAssembly.Module from wrangler.toml [wasm_modules].
   *  Avoids dynamic instantiation which is blocked in _worker.js context. */
  RESVG_WASM?: WebAssembly.Module;
}

export interface OgFunctionContext {
  request: Request;
  env: OgEnv;
  waitUntil: (promise: Promise<unknown>) => void;
}

export async function handleVerseOgRequest(context: OgFunctionContext): Promise<Response> {
  const route = parseVerseOgUrl(new URL(context.request.url));
  if (!route.ok) return errorResponse(route);
  return serveOgPayload(context, route, fetchVerseOgPayload);
}

export async function handleLemmaOgRequest(context: OgFunctionContext): Promise<Response> {
  const route = parseLemmaOgUrl(new URL(context.request.url));
  if (!route.ok) return errorResponse(route);
  return serveOgPayload(context, route, fetchLemmaOgPayload);
}

async function serveOgPayload<T extends OgSuccessPayload, R extends OgSuccessRoute>(
  context: OgFunctionContext,
  route: R,
  loader: (db: Awaited<ReturnType<typeof getCorpusDb>>, parsed: R) => Promise<T | null>,
): Promise<Response> {
  const cache = getDefaultCache();
  const cacheKey = new Request(route.cacheKeyUrl, { method: 'GET' });
  const cached = cache ? await cache.match(cacheKey) : undefined;
  if (cached) return cached;

  // Static-asset precache lookup (verse routes only). `scripts/seo-build-og-cache.ts`
  // writes one JSON per verse to `public/og-cache/<tradition>/<text>/<chapter>/<verse>.json`
  // at build time. The OG handler reads it via `ASSETS.fetch(...)` from the
  // edge cache (~5ms) instead of the libsql HTTPS round-trip (~500ms warm,
  // 1500ms+ cold tail) — eliminating the DB-timeout failure mode that
  // Phase 8 T+24h flagged at 6% fallback rate.
  //
  // On any cache-miss / parse-fail / lookup-error we fall through to the
  // DB path below. The DB path is preserved unchanged so verses added
  // between builds still resolve (rare; production rebuilds happen on
  // every PR merge).
  let payload: T | null = null;
  if (route.kind === 'verse') {
    payload = (await tryLoadFromOgCache(context, route as VerseOgRoute)) as T | null;
  }

  if (payload === null) {
    // AbortController-backed timeout for the DB step. When TURSO env vars are
    // present we route through a per-request libsql client whose custom `fetch`
    // wires `controller.signal` into the upstream HTTP request — so an expired
    // timer ACTUALLY tears down the socket instead of merely racing the response
    // away (the prior `Promise.race` shape leaked subrequests under slow Turso).
    const dbController = new AbortController();
    const dbTimer = setTimeout(() => dbController.abort(), OG_QUERY_TIMEOUT_MS);
    try {
      const db = await getAbortableCorpusDb(dbController.signal);
      try {
        payload = await loader(db, route);
      } catch (error) {
        if (dbController.signal.aborted) {
          throw new Error('OG payload query timed out.');
        }
        throw error;
      }
    } catch (error) {
      clearTimeout(dbTimer);
      if (error instanceof CorpusNotConfiguredError) {
        return fallbackResponse(context, route.cacheKeyUrl, error.message);
      }
      const message = error instanceof Error ? error.message : 'Unknown OG render failure.';
      return fallbackResponse(context, route.cacheKeyUrl, message);
    }
    clearTimeout(dbTimer);
  }

  if (!payload) {
    return shortCacheResponse('OG payload not found.', 404);
  }

  try {
    const png = await withTimeout(renderOgPng(context, payload), OG_RENDER_TIMEOUT_MS, 'OG render timed out.');
    const response = pngResponse(png, OG_SUCCESS_CACHE_CONTROL, {
      'X-OG-Cache-Key': route.cacheKeyUrl,
      'X-OG-Format': 'png',
      'X-OG-Lang': route.lang,
      'X-OG-Renderer': 'resvg-wasm',
    });
    if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    if (error instanceof CorpusNotConfiguredError) {
      return fallbackResponse(context, route.cacheKeyUrl, error.message);
    }
    const message = error instanceof Error ? error.message : 'Unknown OG render failure.';
    return fallbackResponse(context, route.cacheKeyUrl, message);
  }
}

/**
 * Static-asset lookup for the verse OG cache built by
 * `scripts/seo-build-og-cache.ts`. Returns the materialized
 * `VerseOgPayload` on hit, or `null` on any miss / parse failure / fetch
 * error so the caller falls through to the DB path.
 *
 * The asset path mirrors the OG route exactly:
 *   `/og-cache/<tradition>/<text>/<chapter>/<verse>.json`
 * Compact JSON, one verse + all 12 translations per file (~1-3KB).
 *
 * The requested→english fallback logic is applied here (delegated to
 * `buildVerseOgPayloadFromCache`) so the cache file stays language-
 * neutral and future query-shape changes don't require a cache rebuild.
 */
async function tryLoadFromOgCache(
  context: OgFunctionContext,
  route: VerseOgRoute,
): Promise<VerseOgPayload | null> {
  try {
    const cacheUrl = new URL(
      `/og-cache/${route.tradition}/${route.textSlug}/${route.chapter}/${route.verse}.json`,
      context.request.url,
    );
    const response = await context.env.ASSETS.fetch(cacheUrl);
    if (!response.ok) return null;
    const raw = (await response.json()) as unknown;
    return buildVerseOgPayloadFromCache(raw, route);
  } catch {
    return null;
  }
}

async function fallbackResponse(
  context: OgFunctionContext,
  cacheKeyUrl: string,
  reason: string,
): Promise<Response> {
  const cache = getDefaultCache();
  const cacheKey = new Request(cacheKeyUrl, { method: 'GET' });

  for (const assetPath of OG_FALLBACK_ASSET_CANDIDATES) {
    const assetUrl = new URL(assetPath, context.request.url);
    try {
      const assetResponse = await context.env.ASSETS.fetch(assetUrl);
      if (!assetResponse.ok) continue;

      const headers = new Headers(assetResponse.headers);
      headers.set('Cache-Control', OG_FALLBACK_CACHE_CONTROL);
      headers.set('Content-Disposition', 'inline');
      headers.set('Content-Type', headers.get('Content-Type') ?? inferAssetContentType(assetPath));
      headers.set('X-OG-Fallback', 'asset');
      headers.set('X-OG-Fallback-Asset', assetPath);
      headers.set('X-OG-Fallback-Reason', reason);
      headers.set('X-OG-Format', assetPath.endsWith('.png') ? 'png' : 'svg');

      const response = new Response(assetResponse.body, {
        status: 200,
        headers,
      });
      if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch {
      // Fall through to the next asset candidate.
    }
  }

  const response = svgResponse(renderFallbackSvg(reason), OG_FALLBACK_CACHE_CONTROL, {
    'X-OG-Fallback': 'inline',
    'X-OG-Fallback-Reason': reason,
    'X-OG-Format': 'svg',
  });
  if (cache) context.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function errorResponse(error: OgRouteValidationError): Response {
  return shortCacheResponse(error.message, error.status, {
    'X-OG-Error-Code': error.code,
  });
}

function shortCacheResponse(
  body: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(body, {
    status,
    headers: {
      'Cache-Control': OG_FALLBACK_CACHE_CONTROL,
      'Content-Type': 'text/plain; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function svgResponse(
  svg: string,
  cacheControl: string,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(svg, {
    status: 200,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Disposition': 'inline',
      'Content-Type': 'image/svg+xml; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function pngResponse(
  png: Uint8Array,
  cacheControl: string,
  extraHeaders?: Record<string, string>,
): Response {
  const blobPart = png as unknown as ArrayBufferView<ArrayBuffer>;
  return new Response(new Blob([blobPart]), {
    status: 200,
    headers: {
      'Cache-Control': cacheControl,
      'Content-Disposition': 'inline',
      'Content-Type': 'image/png',
      ...extraHeaders,
    },
  });
}

function inferAssetContentType(assetPath: string): string {
  if (assetPath.endsWith('.png')) return 'image/png';
  if (assetPath.endsWith('.svg')) return 'image/svg+xml; charset=utf-8';
  return 'application/octet-stream';
}

function renderOgSvg(payload: OgSuccessPayload): string {
  return payload.kind === 'verse' ? renderVerseSvg(payload) : renderLemmaSvg(payload);
}

function renderVerseSvg(payload: VerseOgPayload): string {
  const devanagari = fitVerseLine(payload.devanagari);
  const secondary = wrapForSvg(payload.secondaryText, payload.secondaryTextKind === 'translation' ? 46 : 52, 4);
  const title = escapeXml(payload.textTitleEn);
  const citation = escapeXml(payload.citation);
  const langLabel = escapeXml((getReadingModeByLang(payload.route.lang)?.englishName ?? payload.route.lang).toUpperCase());
  const footerRight = escapeXml(
    payload.secondaryTextKind === 'translation'
      ? `${payload.translationLang?.toUpperCase() ?? OG_DEFAULT_LANG.toUpperCase()}${payload.fallbackUsed ? ' fallback' : ''}`
      : 'IAST',
  );
  const translationPreview = payload.translation ? wrapForSvg(payload.translation, 64, 2) : [];
  const secondaryFontFamily =
    payload.secondaryTextKind === 'translation'
      ? getOgFontFamilyForLang(payload.secondaryTextLang)
      : "'Source Serif 4', serif";
  const secondaryFontSize = payload.secondaryTextKind === 'translation' ? 28 : 30;
  const secondaryFontStyle = payload.secondaryTextKind === 'translation' ? 'normal' : 'italic';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${escapeXml(`${payload.textTitleEn} ${payload.citation}`)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f7f0df" />
      <stop offset="100%" stop-color="#efe2c2" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="46" y="46" width="1108" height="538" rx="26" fill="#fffaf0" stroke="#d6c5a1" stroke-width="2" />
  <text x="76" y="102" fill="#6a5231" font-family="'Source Serif 4', serif" font-size="26" letter-spacing="1.5">${title}</text>
  <text x="1124" y="102" text-anchor="end" fill="#6a5231" font-family="'Source Serif 4', serif" font-size="24">${citation}</text>
  ${svgTextBlock(devanagari.lines, {
    x: 76,
    y: 178,
    dy: 48,
    fill: '#1d1209',
    fontFamily: "'Noto Serif Devanagari', serif",
    fontSize: devanagari.fontSize,
    fontWeight: '600',
  })}
  ${svgTextBlock(secondary, {
    x: 76,
    y: devanagari.nextY,
    dy: 38,
    fill: '#5f4a2d',
    fontFamily: secondaryFontFamily,
    fontSize: secondaryFontSize,
    fontStyle: secondaryFontStyle,
  })}
  ${
    translationPreview.length > 0
      ? svgTextBlock(translationPreview, {
          x: 76,
          y: 466,
          dy: 24,
          fill: '#7a6241',
          fontFamily: getOgFontFamilyForLang(payload.translationLang ?? payload.route.lang),
          fontSize: 20,
        })
      : ''
  }
  <line x1="76" y1="530" x2="1124" y2="530" stroke="#d6c5a1" stroke-width="2" />
  <text x="76" y="568" fill="#2f2617" font-family="'Source Serif 4', serif" font-size="24">sohamhamso</text>
  <text x="230" y="568" fill="#8c7351" font-family="'Source Serif 4', serif" font-size="20">${escapeXml(payload.route.pagePath)}</text>
  <text x="1124" y="568" text-anchor="end" fill="#6a5231" font-family="'Source Serif 4', serif" font-size="20">${langLabel} · ${footerRight}</text>
</svg>`;
}

function renderLemmaSvg(payload: LemmaOgPayload): string {
  const lemmaSa = payload.lemmaSa ? escapeXml(payload.lemmaSa) : ' ';
  const lemmaIast = escapeXml(payload.lemmaIast);
  const glossLines = wrapForSvg(payload.gloss, 56, 4);
  const glossLang = escapeXml((getReadingModeByLang(payload.glossLang)?.englishName ?? payload.glossLang).toUpperCase());
  const glossFontFamily = getOgFontFamilyForLang(payload.glossLang);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${lemmaIast}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#f5f2eb" />
      <stop offset="100%" stop-color="#ead7b5" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="46" y="46" width="1108" height="538" rx="26" fill="#fffdf8" stroke="#d5c4a1" stroke-width="2" />
  <text x="76" y="106" fill="#6a5231" font-family="'Source Serif 4', serif" font-size="24" letter-spacing="1.6">LEMMA</text>
  <text x="76" y="208" fill="#1d1209" font-family="'Noto Serif Devanagari', serif" font-size="44" font-weight="600">${lemmaSa}</text>
  <text x="76" y="270" fill="#3c2a14" font-family="'Source Serif 4', serif" font-size="34" font-style="italic">${lemmaIast}</text>
  <text x="76" y="344" fill="#6a5231" font-family="'Source Serif 4', serif" font-size="20">${glossLang}${payload.fallbackUsed ? ' fallback' : ''}</text>
  ${svgTextBlock(glossLines, {
    x: 76,
    y: 392,
    dy: 38,
    fill: '#2f2617',
    fontFamily: glossFontFamily,
    fontSize: 28,
  })}
  <line x1="76" y1="498" x2="1124" y2="498" stroke="#d6c5a1" stroke-width="2" />
  <text x="76" y="548" fill="#2f2617" font-family="'Source Serif 4', serif" font-size="24">${escapeXml(`${payload.occurrenceCount} verses`)}</text>
  <text x="1124" y="548" text-anchor="end" fill="#8c7351" font-family="'Source Serif 4', serif" font-size="20">${escapeXml(payload.samplePath)}</text>
  <text x="76" y="584" fill="#6a5231" font-family="'Source Serif 4', serif" font-size="20">sohamhamso · ${escapeXml(payload.route.pagePath)}</text>
</svg>`;
}

function renderFallbackSvg(reason: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="sohamhamso">
  <rect width="1200" height="630" fill="#f3ede0" />
  <rect x="50" y="50" width="1100" height="530" rx="28" fill="#fffaf0" stroke="#d6c5a1" stroke-width="2" />
  <text x="80" y="178" fill="#2f2617" font-family="Georgia, 'Times New Roman', serif" font-size="48">sohamhamso</text>
  <text x="80" y="252" fill="#6a5231" font-family="Georgia, 'Times New Roman', serif" font-size="30">Open Graph preview temporarily unavailable.</text>
  <text x="80" y="312" fill="#8c7351" font-family="Georgia, 'Times New Roman', serif" font-size="22">${escapeXml(reason)}</text>
</svg>`;
}

function fitVerseLine(text: string): { lines: string[]; fontSize: number; nextY: number } {
  const steps = [
    { fontSize: 32, maxChars: 44, maxLines: 3 },
    { fontSize: 28, maxChars: 52, maxLines: 3 },
    { fontSize: 24, maxChars: 60, maxLines: 3 },
  ] as const;

  for (const step of steps) {
    const lines = wrapForSvg(text, step.maxChars, step.maxLines);
    if (lines.join('').length >= text.trim().length || step.fontSize === 24) {
      if (step.fontSize === 24 && lines.join('').length < text.trim().length) {
        const truncated = truncateToFirstPada(text);
        const finalLines = wrapForSvg(truncated, step.maxChars, step.maxLines);
        return {
          lines: finalLines,
          fontSize: step.fontSize,
          nextY: 178 + finalLines.length * 48 + 28,
        };
      }
      return {
        lines,
        fontSize: step.fontSize,
        nextY: 178 + lines.length * 48 + 28,
      };
    }
  }

  return {
    lines: [escapeXml(text)],
    fontSize: 24,
    nextY: 254,
  };
}

function truncateToFirstPada(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const pada = normalized.split(/[।/]/)[0]?.trim();
  return pada && pada.length > 0 ? `${pada} ॥…॥` : normalized;
}

function wrapForSvg(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (!current) {
      lines.push(trimLine(word.slice(0, maxChars - 1), true));
    } else {
      lines.push(escapeXml(current));
      current = word;
    }

    if (lines.length === maxLines) {
      lines[maxLines - 1] = trimLine(unescapeXml(lines[maxLines - 1]), true);
      return lines;
    }
  }

  if (current) lines.push(escapeXml(current));
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines - 1).concat(trimLine(unescapeXml(lines[maxLines - 1]), true));
  }
  return lines;
}

function svgTextBlock(
  lines: string[],
  attrs: {
    x: number;
    y: number;
    dy: number;
    fill: string;
    fontFamily: string;
    fontSize: number;
    fontStyle?: string;
    fontWeight?: string;
  },
): string {
  const extraAttrs = [
    attrs.fontStyle ? `font-style="${attrs.fontStyle}"` : '',
    attrs.fontWeight ? `font-weight="${attrs.fontWeight}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const tspans = lines
    .map((line, index) =>
      index === 0
        ? `<tspan x="${attrs.x}" dy="0">${line}</tspan>`
        : `<tspan x="${attrs.x}" dy="${attrs.dy}">${line}</tspan>`,
    )
    .join('');
  return `<text x="${attrs.x}" y="${attrs.y}" fill="${attrs.fill}" font-family="${attrs.fontFamily}" font-size="${attrs.fontSize}" ${extraAttrs}>${tspans}</text>`;
}

function trimLine(text: string, ellipsis: boolean): string {
  const clean = text.trim().replace(/[.,;:!?-]+$/g, '');
  return escapeXml(ellipsis ? `${clean}…` : clean);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function getOgFontFamilyForLang(lang: string): string {
  const mode = getReadingModeByLang(lang);
  if (!mode) return "'Source Serif 4', serif";
  switch (mode.scriptId) {
    case 'devanagari':
      return "'Noto Serif Devanagari', serif";
    case 'bengali':
    case 'assamese':
      return "'Noto Serif Bengali', serif";
    case 'gujarati':
      return "'Noto Serif Gujarati', serif";
    case 'gurmukhi':
      return "'Noto Serif Gurmukhi', serif";
    case 'kannada':
      return "'Noto Serif Kannada', serif";
    case 'malayalam':
      return "'Noto Serif Malayalam', serif";
    case 'oriya':
      return "'Noto Serif Oriya', serif";
    case 'tamil':
      return "'Noto Serif Tamil', serif";
    case 'telugu':
      return "'Noto Serif Telugu', serif";
    case 'iast':
    default:
      return "'Source Serif 4', serif";
  }
}

async function renderOgPng(
  context: OgFunctionContext,
  payload: OgSuccessPayload,
): Promise<Uint8Array> {
  const svg = renderOgSvg(payload);
  const [{ Resvg }, fontBuffers] = await Promise.all([
    ensureResvgReady(context),
    loadOgFontBuffers(context),
  ]);

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: {
      fontBuffers,
      defaultFontFamily: 'Source Serif 4',
      serifFamily: 'Source Serif 4',
      sansSerifFamily: 'Inter',
    },
  });

  const rendered = resvg.render();
  try {
    return rendered.asPng();
  } finally {
    rendered.free();
    resvg.free();
  }
}

async function ensureResvgReady(
  context: OgFunctionContext,
): Promise<typeof import('@resvg/resvg-wasm')> {
  _resvgModulePromise ??= import('@resvg/resvg-wasm');
  if (!_resvgReadyPromise) {
    _resvgReadyPromise = (async () => {
      const resvg = await _resvgModulePromise;
      // Prefer the pre-compiled WebAssembly.Module injected via wrangler.toml
      // [wasm_modules] — CF Workers blocks dynamic WebAssembly.instantiate()
      // in the _worker.js context (Wasm code generation disallowed).
      // Fall back to fetching the .wasm asset only when the binding is absent
      // (e.g., local dev or the legacy CF Pages Functions path).
      const wasmSource: WebAssembly.Module | Response = context.env.RESVG_WASM
        ?? await (async () => {
          const wasmResponse = await context.env.ASSETS.fetch(
            new URL(OG_RUNTIME_WASM_ASSET, context.request.url),
          );
          if (!wasmResponse.ok) {
            throw new Error(`OG renderer wasm asset unavailable: ${OG_RUNTIME_WASM_ASSET}.`);
          }
          return wasmResponse;
        })();
      await resvg.initWasm(wasmSource);
      return resvg;
    })().catch((error) => {
      _resvgReadyPromise = null;
      throw error;
    });
  }
  return _resvgReadyPromise;
}

async function loadOgFontBuffers(context: OgFunctionContext): Promise<Uint8Array[]> {
  if (!_ogFontBuffersPromise) {
    _ogFontBuffersPromise = Promise.all(
      FONT_ASSET_PATHS.map((assetPath) => fetchAssetBytes(context, assetPath)),
    ).catch((error) => {
      _ogFontBuffersPromise = null;
      throw error;
    });
  }
  return _ogFontBuffersPromise;
}

async function fetchAssetBytes(context: OgFunctionContext, assetPath: string): Promise<Uint8Array> {
  const response = await context.env.ASSETS.fetch(new URL(assetPath, context.request.url));
  if (!response.ok) {
    throw new Error(`OG asset unavailable: ${assetPath}.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function getDefaultCache(): Cache | undefined {
  if (typeof caches === 'undefined') return undefined;
  return (caches as CacheStorage & { default: Cache }).default;
}

/**
 * Build a `CorpusDb` whose underlying libsql HTTP requests honor the supplied
 * `AbortSignal`. When the OG request's `OG_QUERY_TIMEOUT_MS` timer fires, the
 * signal aborts, the libsql custom `fetch` propagates the abort to the upstream
 * Turso socket, and the in-flight subrequest is actually canceled — preventing
 * the worker subrequest pileup the audit flagged as a DoS amplification risk.
 *
 * Falls back to the shared `getCorpusDb()` singleton (which honors
 * `__setCorpusDbForTests` and the bun-runtime path) when no Turso env vars
 * are present. This preserves bun/SSG/test behavior unchanged.
 */
async function getAbortableCorpusDb(signal: AbortSignal): Promise<CorpusDb> {
  const url = typeof process !== 'undefined' ? process.env.TURSO_CORPUS_URL : undefined;
  const authToken =
    typeof process !== 'undefined' ? process.env.TURSO_CORPUS_AUTH_TOKEN : undefined;
  if (!url || !authToken) {
    return getCorpusDb();
  }

  // Per-request libsql client. The `createClient(...)` call itself is cheap;
  // the expensive part is the dynamic `import('@libsql/client/web')` chunk
  // load on a cold isolate, which we now memoize at module scope so only the
  // FIRST request per isolate pays it. The per-request client (and its
  // AbortSignal-aware custom fetch) is preserved — concurrent requests would
  // cross-contaminate signals if we shared a single client.
  _libsqlClientImportPromise ??= import('@libsql/client/web');
  const { createClient } = await _libsqlClientImportPromise;
  const client = createClient({
    url,
    authToken,
    // Custom fetch closes over our `signal`. Merges with any libsql-supplied
    // init (e.g. headers, body) so we don't clobber the driver's request shape.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input as RequestInfo, { ...(init ?? {}), signal })) as unknown as (
      ...args: unknown[]
    ) => Promise<Response>,
  });

  function adaptRow<T>(row: Record<string, unknown>): T {
    if ('embedding' in row && row.embedding != null) {
      const v = row.embedding;
      let buf: Buffer;
      if (Buffer.isBuffer(v)) buf = v;
      else if (v instanceof ArrayBuffer) buf = Buffer.from(v);
      else if (v instanceof Uint8Array) buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
      else if (typeof v === 'string') buf = Buffer.from(v, 'base64');
      else throw new Error(`og corpus-db: unexpected BLOB type: ${typeof v}`);
      return { ...row, embedding: buf } as T;
    }
    return row as T;
  }

  return {
    async all<T>(sql: string, params: ReadonlyArray<string | number | null> = []): Promise<T[]> {
      const res = await client.execute({ sql, args: [...params] });
      return res.rows.map((r) => adaptRow<T>(r as unknown as Record<string, unknown>));
    },
    async get<T>(
      sql: string,
      params: ReadonlyArray<string | number | null> = [],
    ): Promise<T | undefined> {
      const res = await client.execute({ sql, args: [...params] });
      if (res.rows.length === 0) return undefined;
      return adaptRow<T>(res.rows[0] as unknown as Record<string, unknown>);
    },
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * Test hook — reset the module-scope memoization of the libsql `/web` import.
 * Lets regression tests assert that the import is paid at most once across
 * multiple requests within the same isolate. Production code MUST NOT call
 * this; it exists so the cold-isolate timeout fix has explicit test coverage.
 */
export function __resetLibsqlClientImportForTests(): void {
  _libsqlClientImportPromise = null;
}

/** Test hook — read-only snapshot of whether the libsql import was paid. */
export function __libsqlClientImportPaidForTests(): boolean {
  return _libsqlClientImportPromise !== null;
}

/** Exported timeout constant so tests can assert the budget didn't regress. */
export const __OG_QUERY_TIMEOUT_MS_FOR_TESTS = OG_QUERY_TIMEOUT_MS;
