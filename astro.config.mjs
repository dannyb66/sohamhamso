import cloudflare from '@astrojs/cloudflare';
import solid from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';
// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://sohamhamso.org',
  // `output: 'static'` is correct even though the two verse routes render
  // on demand: Astro 5 folded the old 'hybrid' mode into 'static' — any
  // route exporting `prerender = false` (the verse pages, /search, /api/*)
  // runs in the Cloudflare worker at request time while everything else
  // stays prerendered. The verse routes moved to SSR in A6 phase 2 to keep
  // dist/ far below CF Pages' 20,000-file deploy limit (one static file
  // per verse × 12 locales did not scale past the first two texts).
  output: 'static',
  // `trailingSlash: 'never'` + `build.format: 'file'` makes Astro emit
  // `dist/foo.html` (not `dist/foo/index.html`), so Cloudflare Pages serves
  // canonical bare URLs directly with no 308 trailing-slash redirect.
  // Lighthouse observed a 777-791 ms penalty on deep URLs; sitemap,
  // hreflang, canonical, and internal hrefs all already emit no-slash form
  // via `localePathFor → normalizePath`, so this is the canonical-aligned
  // setting.
  trailingSlash: 'never',
  build: {
    format: 'file',
  },
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [solid()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'as'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
