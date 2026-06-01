// @ts-check
import { defineConfig } from 'astro/config';
import solid from '@astrojs/solid-js';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://sohamhamso.org',
  output: 'static',
  trailingSlash: 'ignore',
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
