import { test, expect } from "@playwright/test";

/**
 * Routing redirect tests.
 *
 * Two classes of UX trap that need to land on the canonical URL:
 *   1. Wrong tradition prefix — most texts live under /trika/, so users type
 *      /trika/karpuradi-stotra (actually /shakta/). Don't 404.
 *   2. Slug romanization variants — vocalic ṛ may be spelled "ri" (hridayam vs
 *      hrdayam), ś as "sh" (shiva vs siva), etc.
 *
 * Implementation: src/lib/aliases.ts + getStaticPaths in the verse / text-index
 * pages enumerate every non-canonical (tradition, slug) combination and emit
 * a redirect-only page. In static output that becomes a meta-refresh HTML
 * file; Cloudflare adapter promotes it to a real 301 at the edge.
 *
 * Dev server (`bun dev`) returns the underlying Response (301 + Location), so
 * we assert on the manual-redirect response. We also assert the followed
 * navigation lands at the canonical URL.
 */

test.describe("routing redirects", () => {
  const cases: Array<{ from: string; to: string; label: string }> = [
    {
      label: "wrong tradition: trika → shakta (karpuradi-stotra is shakta)",
      from: "/trika/karpuradi-stotra/1/1",
      to: "/shakta/karpuradi-stotra/1/1",
    },
    {
      label: "wrong tradition on text-overview URL",
      from: "/trika/karpuradi-stotra",
      to: "/shakta/karpuradi-stotra",
    },
    {
      label: "slug alias: hridayam (with i) → hrdayam (vocalic ṛ)",
      from: "/trika/pratyabhijna-hridayam/1/1",
      to: "/trika/pratyabhijna-hrdayam/1/1",
    },
    {
      label: "slug alias + wrong tradition combined (hridayam + shakta)",
      from: "/shakta/pratyabhijna-hridayam/1/1",
      to: "/trika/pratyabhijna-hrdayam/1/1",
    },
    {
      label: "slug alias: shiva-sutras (sh) → siva-sutras (s)",
      from: "/trika/shiva-sutras/1/1",
      to: "/trika/siva-sutras/1/1",
    },
    {
      label: "slug alias: spanda-karika (singular) → spanda-karikas",
      from: "/trika/spanda-karika/1/1",
      to: "/trika/spanda-karikas/1/1",
    },
  ];

  for (const c of cases) {
    test(c.label, async ({ page }) => {
      // 1. Raw response without following: must be 3xx pointing at canonical.
      const resp = await page.request.get(c.from, { maxRedirects: 0 });
      expect.soft(resp.status(), `expected 3xx for ${c.from}`).toBeGreaterThanOrEqual(300);
      expect.soft(resp.status()).toBeLessThan(400);
      expect.soft(resp.headers().location, `Location header for ${c.from}`).toBe(c.to);

      // 2. Followed navigation lands at canonical and returns a 2xx page.
      const nav = await page.goto(c.from);
      expect(nav?.status()).toBeLessThan(400);
      expect(new URL(page.url()).pathname).toBe(c.to);
    });
  }

  test("canonical URLs are NOT redirected", async ({ page }) => {
    // Belt-and-suspenders: we should not have accidentally clobbered a real
    // page with a redirect. Each text's canonical (tradition, slug) must
    // still render at 200.
    const canonical = [
      "/shakta/karpuradi-stotra/1/1",
      "/trika/pratyabhijna-hrdayam/1/1",
      "/trika/siva-sutras/1/1",
      "/trika/spanda-karikas/1/1",
      "/trika/vijnana-bhairava-tantra/1/1",
    ];
    for (const u of canonical) {
      const resp = await page.request.get(u, { maxRedirects: 0 });
      expect(resp.status(), `${u} should be 200, got ${resp.status()}`).toBe(200);
    }
  });

  test("unknown slug returns 404 (no fuzzy match)", async ({ page }) => {
    // Curated aliases only — random unknown slugs must NOT match.
    const resp = await page.request.get("/trika/totally-fake-text/1/1", {
      maxRedirects: 0,
    });
    expect(resp.status()).toBe(404);
  });
});
