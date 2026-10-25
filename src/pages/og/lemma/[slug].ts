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
  const runtime = (
    locals as
      | { runtime?: { env?: OgFunctionContext['env']; waitUntil?: OgFunctionContext['waitUntil'] } }
      | undefined
  )?.runtime;
  const ctx: OgFunctionContext = {
    request,
    env: runtime?.env ?? {
      ASSETS: { fetch: (input: RequestInfo | URL) => fetch(input as RequestInfo) },
    },
    waitUntil: runtime?.waitUntil ?? (() => {}),
  };
  return handleLemmaOgRequest(ctx);
};
