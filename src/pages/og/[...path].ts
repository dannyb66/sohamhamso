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

import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import type { APIRoute } from 'astro';
import { type OgFunctionContext, handleVerseOgRequest } from '../../../functions/og/_shared';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const runtime = (
    locals as
      | { runtime?: { env?: OgFunctionContext['env']; waitUntil?: OgFunctionContext['waitUntil'] } }
      | undefined
  )?.runtime;
  const ctx: OgFunctionContext = {
    request,
    env: {
      ...(runtime?.env ?? {
        ASSETS: { fetch: (input: RequestInfo | URL) => fetch(input as RequestInfo) },
      }),
      RESVG_WASM: resvgWasm instanceof WebAssembly.Module ? resvgWasm : undefined,
    },
    waitUntil: runtime?.waitUntil ?? (() => {}),
  };
  return handleVerseOgRequest(ctx);
};
