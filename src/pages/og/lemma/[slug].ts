/**
 * Astro SSR endpoint for lemma OG image generation.
 *
 * Delegates entirely to the existing handler in functions/og/_shared.ts.
 * See src/pages/og/[...path].ts for the rationale.
 *
 * Route: /og/lemma/{slug}[?lang={code}]
 */

import type { APIRoute } from 'astro';
import { type OgFunctionContext, handleLemmaOgRequest } from '../../../../functions/og/_shared';
// @ts-expect-error — resolved by src/wasm.d.ts; see src/pages/og/[...path].ts
import resvgWasm from '../../../../public/og-runtime/resvg-index_bg.wasm';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const ctx: OgFunctionContext = {
    request,
    env: {
      ASSETS: { fetch: (input: RequestInfo | URL) => fetch(input as RequestInfo) },
      TURSO_CORPUS_URL: process.env.TURSO_CORPUS_URL,
      TURSO_CORPUS_AUTH_TOKEN: process.env.TURSO_CORPUS_AUTH_TOKEN,
      RESVG_WASM: resvgWasm as WebAssembly.Module,
    },
    waitUntil: () => {},
  };
  return handleLemmaOgRequest(ctx);
};
