import { listChapters } from '../lib/db';
import { filterIndexableTextLangs, liveLocaleSet, localePathFor, SITE_URL } from '../lib/seo';
import { getTexts } from '../lib/seo/corpus-bundle';
import { xmlEscape } from '../lib/seo/xml-escape';

export function GET() {
  const BUILD_DATE = new Date().toISOString().split('T')[0];
  const liveLangs = Array.from(liveLocaleSet());
  const urls = getTexts().flatMap((text) =>
    listChapters(text.slug).flatMap((chapter) =>
      filterIndexableTextLangs(text.slug, liveLangs).map(
        (lang) =>
          `${SITE_URL}${xmlEscape(localePathFor(`/${text.tradition}/${text.slug}/${chapter.chapter}`, lang))}`,
      ),
    ),
  );

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
