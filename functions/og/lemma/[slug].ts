import { type OgFunctionContext, handleLemmaOgRequest } from '../_shared';

export async function onRequest(context: OgFunctionContext): Promise<Response> {
  return handleLemmaOgRequest(context);
}
