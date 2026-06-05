import { type OgFunctionContext, handleVerseOgRequest } from './_shared';

export async function onRequest(context: OgFunctionContext): Promise<Response> {
  return handleVerseOgRequest(context);
}
