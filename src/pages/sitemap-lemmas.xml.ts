import { getLemmaRoutes } from '../lib/seo/corpus-bundle';
import { liveLocaleSet, localePathFor, SITE_URL } from '../lib/seo';
import { xmlEscape } from '../lib/seo/xml-escape';

export function GET() {
  const liveLangs = Array.from(liveLocaleSet());
  const urls = getLemmaRoutes().flatMap((route) =>
    liveLangs.map((lang) => `${SITE_URL}${xmlEscape(localePathFor(`/lemma/${route.slug}`, lang))}`),
  );

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
