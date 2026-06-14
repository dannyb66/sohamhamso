import { type Page, expect, test } from '@playwright/test';

/**
 * Paratrīśikā (slug: paratrisika) live-render parity.
 *
 * Paratrīśikā was translated to 12 languages and merged into
 * data/corpus/paratrisika.yaml. This spec asserts the newly-ingested text
 * renders with the SAME page anatomy as the Phase-1 baseline (siva-sutras),
 * so it inherits the established verse/overview/wordsheet/redirect chrome.
 *
 * These routes are SSR (prerender=false) — they require a running dev server
 * (playwright.config.ts webServer: `bun dev`), not static dist output.
 */

const PARA_VERSE = '/trika/paratrisika/1/1';
const BASE_VERSE = '/trika/siva-sutras/1/1';
const WORD_DIALOG = 'dialog[aria-label="Word details"]';

// client:idle hydration can land after 'load' on a cold dev compile; retry the
// tap until the document-level WordSheet delegation listener is attached.
async function openSheet(page: Page) {
  const word = page.locator('.sa-word').first();
  const sheet = page.locator(WORD_DIALOG).first();
  await expect(async () => {
    await word.click();
    await expect(sheet).toBeVisible({ timeout: 400 });
  }).toPass({ timeout: 10_000 });
  return sheet;
}

test.describe('Paratrīśikā — verse page anatomy parity vs siva-sutras', () => {
  test('renders exactly one h1', async ({ page }) => {
    await page.goto(PARA_VERSE);
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test('h1 carries the localized text title + position (Parātrīśikā 1.1)', async ({ page }) => {
    await page.goto(PARA_VERSE);
    const h1 = (await page.locator('h1').first().innerText()).trim();
    expect(h1).toContain('Parātrīśikā');
    expect(h1).toContain('1.1');
  });

  test('DOM order: Devanāgarī → IAST → translation (Vedabase shape)', async ({ page }) => {
    await page.goto(PARA_VERSE);
    const body = await page.evaluate(() => document.body.innerHTML);
    // Devanāgarī from verse 1.1 opening: श्रीदेव्य् उवाच …
    const devaIdx = body.indexOf('श्रीदेव्य्');
    // IAST transliteration of the same.
    const iastIdx = body.indexOf('śrīdevy');
    // English translation phrase.
    const transIdx = body.indexOf('venerable Goddess said');
    expect(devaIdx, 'Devanāgarī missing').toBeGreaterThan(-1);
    expect(iastIdx, 'IAST missing').toBeGreaterThan(-1);
    expect(transIdx, 'English translation missing').toBeGreaterThan(-1);
    expect(devaIdx, 'Devanāgarī before IAST').toBeLessThan(iastIdx);
    expect(iastIdx, 'IAST before translation').toBeLessThan(transIdx);
  });

  test('word-by-word synonyms region with tappable .sa-word buttons', async ({ page }) => {
    await page.goto(PARA_VERSE);
    const region = page.locator('[aria-label="word-by-word synonyms"]');
    await expect(region).toHaveCount(1);
    const words = page.locator('.sa-word');
    // 11 lemmas in verse 1.1; assert the buttons exist and are real <button>s.
    expect(await words.count()).toBeGreaterThan(1);
    await expect(words.first()).toHaveJSProperty('tagName', 'BUTTON');
  });

  test('AI-assisted badge present (AI · not verified)', async ({ page }) => {
    await page.goto(PARA_VERSE);
    const badge = page.locator('.ai-badge');
    await expect(badge).toBeVisible();
    // paratrisika is AI-translated → amber variant; siva-sutras is
    // public-domain → slate. Same component, attribution-driven variant.
    await expect(badge).toHaveClass(/ai-badge--amber/);
    await expect(badge).toContainText(/AI/i);
  });

  test('wayfinding position indicator shows "1.1 / 36"', async ({ page }) => {
    await page.goto(PARA_VERSE);
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/1\.1\s*\/\s*36/);
  });

  test('language switcher (Also available in) is present', async ({ page }) => {
    await page.goto(PARA_VERSE);
    await expect(page.locator('[aria-label="Also available in"]')).toHaveCount(1);
  });

  test('parity: same top-level section landmarks as siva-sutras', async ({ page }) => {
    const landmarks = async (url: string) => {
      await page.goto(url);
      return page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return [];
        return Array.from(main.querySelectorAll('[aria-label], article, nav'))
          .map((el) => el.getAttribute('aria-label') || el.tagName.toLowerCase())
          .filter(Boolean);
      });
    };
    const para = await landmarks(PARA_VERSE);
    const base = await landmarks(BASE_VERSE);
    // The structural anchors that define the verse page must exist on both.
    for (const anchor of ['Breadcrumb', 'word-by-word synonyms', 'Also available in']) {
      expect(base, `baseline missing ${anchor}`).toContain(anchor);
      expect(para, `paratrisika missing ${anchor}`).toContain(anchor);
    }
  });
});

test.describe('Paratrīśikā — WordSheet interaction parity', () => {
  test('tapping a .sa-word opens the sheet with lemma + gloss', async ({ page }) => {
    await page.goto(PARA_VERSE);
    await page.waitForLoadState('load');
    const sheet = await openSheet(page);

    const lemma = sheet.locator('.word-sheet__lemma');
    await expect(lemma).toBeVisible();
    expect((await lemma.innerText()).trim().length).toBeGreaterThan(0);

    // First word of 1.1 is श्रीदेव्य् / śrīdevy → "the venerable Goddess".
    const gloss = sheet.locator('.word-sheet__gloss, .word-sheet__empty');
    await expect(gloss.first()).toBeVisible();
  });

  test('Escape dismisses the sheet', async ({ page }) => {
    await page.goto(PARA_VERSE);
    await page.waitForLoadState('load');
    const sheet = await openSheet(page);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden({ timeout: 2000 });
  });
});

test.describe('Paratrīśikā — Hindi locale mirror', () => {
  const HI_VERSE = '/hi/trika/paratrisika/1/1';

  test('renders Hindi translation (Devanāgarī, not English)', async ({ page }) => {
    await page.goto(HI_VERSE);
    const para = page.locator('main article p').first();
    const txt = (await para.innerText()).trim();
    // Hindi translation opens "श्रीदेवी ने कहा …".
    expect(txt).toContain('श्रीदेवी');
    expect(txt).toContain('कहा');
  });

  test('glosses render Hindi sense (not English)', async ({ page }) => {
    await page.goto(HI_VERSE);
    const region = page.locator('[aria-label="word-by-word synonyms"]');
    const txt = await region.innerText();
    // Hindi gloss for śrīdevy is "श्रीदेवी … पूज्या देवी".
    expect(txt).toContain('पूज्या देवी');
  });

  test('language switcher offers a route back to English canonical', async ({ page }) => {
    await page.goto(HI_VERSE);
    const link = page.locator('[aria-label="Also available in"] a').first();
    await expect(link).toHaveAttribute('href', '/trika/paratrisika/1/1');
  });
});

test.describe('Paratrīśikā — text overview parity', () => {
  test('overview lists 36 verses across chapter rows', async ({ page }) => {
    await page.goto('/trika/paratrisika');
    await expect(page.locator('h1')).toHaveCount(1);
    const body = await page.locator('main').innerText();
    expect(body).toContain('36 verses');
    // Chapter table row links, same anatomy as siva-sutras overview.
    const chapterLinks = page.locator('a[href*="/trika/paratrisika/1"]');
    expect(await chapterLinks.count()).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: /Read chapter 1/i })).toBeVisible();
  });
});

test.describe('Paratrīśikā — error path + alias parity', () => {
  test('out-of-range verse returns a styled 404', async ({ page }) => {
    const resp = await page.goto('/trika/paratrisika/99/99');
    expect(resp?.status()).toBe(404);
    // Styled custom 404, not a bare error — site chrome + a heading render.
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('body')).toContainText('404');
  });

  test('romanization alias paratrishika → 301 canonical paratrisika', async ({ page }) => {
    const resp = await page.request.get('/trika/paratrishika/1/1', { maxRedirects: 0 });
    expect.soft(resp.status()).toBeGreaterThanOrEqual(300);
    expect.soft(resp.status()).toBeLessThan(400);
    expect.soft(resp.headers().location).toBe('/trika/paratrisika/1/1');

    const nav = await page.goto('/trika/paratrishika/1/1');
    expect(nav?.status()).toBeLessThan(400);
    expect(new URL(page.url()).pathname).toBe('/trika/paratrisika/1/1');
  });
});
