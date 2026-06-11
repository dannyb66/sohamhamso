import { SITE_URL } from '../lib/seo';

const parts = [
  '/sitemap-verses.xml',
  '/sitemap-chapters.xml',
  '/sitemap-texts.xml',
  '/sitemap-lemmas.xml',
  '/sitemap-chrome.xml',
];

export function GET() {
  const BUILD_DATE = new Date().toISOString().split('T')[0];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${parts.map((part) => `  <sitemap><loc>${SITE_URL}${part}</loc><lastmod>${BUILD_DATE}</lastmod></sitemap>`).join('\n')}
</sitemapindex>`;
  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
