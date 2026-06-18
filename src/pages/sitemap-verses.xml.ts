import {
  SITE_URL,
  filterIndexableTextLangs,
  getCanonicalVerseRoutes,
  liveLocaleSet,
  localePathFor,
} from '../lib/seo';
import { xmlEscape } from '../lib/seo/xml-escape';

export function GET() {
  const BUILD_DATE = new Date().toISOString().split('T')[0];
  const liveLangs = Array.from(liveLocaleSet());
  const urls = getCanonicalVerseRoutes().flatMap((route) => {
    const basePath = `/${route.tradition}/${route.text}/${route.chapter}/${route.verse}`;
    return filterIndexableTextLangs(route.text, liveLangs).map(
      (lang) => `${SITE_URL}${xmlEscape(localePathFor(basePath, lang))}`,
    );
  });

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc><lastmod>${BUILD_DATE}</lastmod></url>`).join('\n')}
</urlset>`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
