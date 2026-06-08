/**
 * Astro SSR endpoint for verse + default OG image generation.
 *
 * Delegates entirely to the existing handler in functions/og/_shared.ts.
 * This file exists because the Astro CF adapter bundles a _worker.js that
 * takes precedence over CF Pages Functions in functions/, so the OG functions
 * must live as Astro SSR endpoints to be reachable.
 *
 * Route: /og/{tradition}/{text}/{chapter}/{verse}[?lang={code}]
 */

import type { APIRoute } from 'astro';
import { type OgFunctionContext, handleVerseOgRequest } from '../../../functions/og/_shared';
// Static .wasm import — wrangler's rollup plugin pre-compiles this into a
// WebAssembly.Module at bundle time, avoiding the dynamic instantiate() call
// that CF modules Workers block ("Wasm code generation disallowed").
// @ts-expect-error — resolved by src/wasm.d.ts; vite passes through to wrangler
import resvgWasm from '../../../public/og-runtime/resvg-index_bg.wasm';

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
  return handleVerseOgRequest(ctx);
};
