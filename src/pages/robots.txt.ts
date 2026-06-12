import { NON_ENGLISH_LANGS, SITE_URL, liveLocaleSet } from '../lib/seo';

export function buildRobotsTxt(): string {
  const live = liveLocaleSet();
  const localeDisallowed = NON_ENGLISH_LANGS.filter((lang) => !live.has(lang)).map(
    (lang) => `Disallow: /${lang}/`,
  );
  const baseDisallowed = [
    'Disallow: /api/',
    'Disallow: /search',
    'Disallow: /og/',
    'Disallow: /confirmed',
    'Disallow: /unsubscribed',
  ];
  const sitemaps = [
    `Sitemap: ${SITE_URL}/sitemap-index.xml`,
    `Sitemap: ${SITE_URL}/sitemap-verses.xml`,
    `Sitemap: ${SITE_URL}/sitemap-texts.xml`,
    `Sitemap: ${SITE_URL}/sitemap-lemmas.xml`,
    `Sitemap: ${SITE_URL}/sitemap-chrome.xml`,
  ];
  return ['User-agent: *', ...baseDisallowed, ...localeDisallowed, '', ...sitemaps].join('\n');
}

export function GET() {
  return new Response(buildRobotsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
