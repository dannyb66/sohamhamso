import { CorpusNotConfiguredError, getCorpusDb } from '../../src/lib/corpus-db';
import { FONT_ASSET_PATHS } from '../../src/lib/font-assets';
import {
  type LemmaOgPayload,
  type LemmaOgRoute,
  OG_DEFAULT_LANG,
  type OgRouteValidationError,
  type VerseOgPayload,
  type VerseOgRoute,
  fetchLemmaOgPayload,
  fetchVerseOgPayload,
  parseLemmaOgUrl,
  parseVerseOgUrl,
} from '../../src/lib/seo/og-payload';
import { getReadingModeByLang } from '../../src/lib/reading-modes';

const OG_SUCCESS_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const OG_FALLBACK_CACHE_CONTROL = 'public, max-age=60';
const OG_QUERY_TIMEOUT_MS = 500;
const OG_RENDER_TIMEOUT_MS = 2000;
const OG_FALLBACK_ASSET_CANDIDATES = ['/og-default.png', '/og-default.svg'] as const;
const OG_RUNTIME_WASM_ASSET = '/og-runtime/resvg-index_bg.wasm';

type OgSuccessPayload = VerseOgPayload | LemmaOgPayload;
type OgSuccessRoute = VerseOgRoute | LemmaOgRoute;

let _resvgModulePromise: Promise<typeof import('@resvg/resvg-wasm')> | null = null;
let _resvgReadyPromise: Promise<typeof import('@resvg/resvg-wasm')> | null = null;
let _ogFontBuffersPromise: Promise<Uint8Array[]> | null = null;

export interface OgEnv {
  ASSETS: { fetch: typeof fetch };
  TURSO_CORPUS_URL?: string;
  TURSO_CORPUS_AUTH_TOKEN?: string;
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

  try {
    const db = await withTimeout(getCorpusDb(), OG_QUERY_TIMEOUT_MS, 'Corpus DB init timed out.');
    const payload = await withTimeout(loader(db, route), OG_QUERY_TIMEOUT_MS, 'OG payload query timed out.');
    if (!payload) {
      return shortCacheResponse('OG payload not found.', 404);
    }

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
      const wasmResponse = await context.env.ASSETS.fetch(new URL(OG_RUNTIME_WASM_ASSET, context.request.url));
      if (!wasmResponse.ok) {
        throw new Error(`OG renderer wasm asset unavailable: ${OG_RUNTIME_WASM_ASSET}.`);
      }
      await resvg.initWasm(wasmResponse);
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
