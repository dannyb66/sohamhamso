// @ts-check
import { defineConfig } from 'astro/config';
import solid from '@astrojs/solid-js';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://sohamhamso.org',
  output: 'static',
  trailingSlash: 'ignore',
  adapter: cloudflare({ imageService: 'compile' }),
  integrations: [solid()],
  vite: {
    plugins: [tailwindcss()],
  },
  i18n: {
    defaultLocale: 'en',
    locales: [
      'en',
      'hi',
      'ta',
      'te',
      'bn',
      'mr',
      'gu',
      'kn',
      'ml',
      'pa',
      'or',
      'as',
    ],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
