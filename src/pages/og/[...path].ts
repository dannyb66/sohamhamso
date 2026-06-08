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

export const GET: APIRoute = async ({ request }) => {
  const ctx: OgFunctionContext = {
    request,
    env: {
      // ASSETS binding: wrap fetch so the handler can load static assets
      // (fallback PNG, wasm, fonts) via their absolute public URLs.
      ASSETS: { fetch: (input: RequestInfo | URL) => fetch(input as RequestInfo) },
      TURSO_CORPUS_URL: process.env.TURSO_CORPUS_URL,
      TURSO_CORPUS_AUTH_TOKEN: process.env.TURSO_CORPUS_AUTH_TOKEN,
    },
    waitUntil: () => {},
  };
  return handleVerseOgRequest(ctx);
};
