import { SITE_URL, getChromeSitemapPaths } from '../lib/seo';
import { xmlEscape } from '../lib/seo/xml-escape';

export function GET() {
  const BUILD_DATE = new Date().toISOString().split('T')[0];
  const urls = getChromeSitemapPaths().map((path) => `${SITE_URL}${xmlEscape(path)}`);

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
