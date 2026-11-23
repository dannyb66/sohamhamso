import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-iphone-13',
      // iPhone 13 device descriptor defaults to webkit; pin to chromium so
      // CI doesn't require a second browser download. Viewport + UA preserved.
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: [
    {
      command: 'bun dev',
      url: 'http://localhost:4321',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Analytics-on twin of the server above: same app, plus a dummy GA4
      // measurement ID so tests/e2e/analytics-consent.spec.ts can exercise
      // the consent flow. Every other spec runs against :4321, where the ID
      // is unset and analytics must render nothing. The spec stubs all
      // googletagmanager.com requests — nothing reaches Google.
      command: 'bun --bun astro dev --port 4322',
      url: 'http://localhost:4322',
      env: {
        PUBLIC_GA_MEASUREMENT_ID: 'G-E2ETEST000',
        ASTRO_VITE_CACHE_DIR: 'node_modules/.vite-analytics-e2e',
      },
      // Never reuse: a :4322 started without the dummy ID would make the
      // consent suite fail in confusing ways. A busy port fails loudly.
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
