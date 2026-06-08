import cloudflare from '@astrojs/cloudflare';
import solid from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';
// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://sohamhamso.org',
  output: 'static',
  trailingSlash: 'ignore',
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
