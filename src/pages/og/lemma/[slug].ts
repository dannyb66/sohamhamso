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

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: Record<string, unknown> } }).runtime?.env ?? {};
  const ctx: OgFunctionContext = {
    request,
    env: {
      ASSETS: { fetch: (input: RequestInfo | URL) => fetch(input as RequestInfo) },
      TURSO_CORPUS_URL: process.env.TURSO_CORPUS_URL,
      TURSO_CORPUS_AUTH_TOKEN: process.env.TURSO_CORPUS_AUTH_TOKEN,
      RESVG_WASM: runtimeEnv.RESVG_WASM as WebAssembly.Module | undefined,
    },
    waitUntil: () => {},
  };
  return handleLemmaOgRequest(ctx);
};
