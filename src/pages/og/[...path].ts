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

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  // CF wasm_modules binding injected by wrangler.toml [wasm_modules].
  // Bypasses the dynamic WebAssembly.instantiate() blocked in _worker.js.
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
  return handleVerseOgRequest(ctx);
};
