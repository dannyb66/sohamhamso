import { expect, test } from '@playwright/test';

/**
 * ParallelChip.astro — "📜 parallels (N)" disclosure pill on verse pages.
 *
 * V1 invariant: the chip is hidden when the source verse has zero entries
 * in the `parallels` table. Our entire V1 corpus currently has an empty
 * parallels table — populating it (LLM extraction + reviewer verification)
 * is the next step on the parallels feature track. Until then this test
 * documents the count=0 hide rule and pins the markup contract.
 *
 * When parallels start landing, add a second test that visits a
 * known-parallel verse and asserts the disclosure body contains
 * `.parallels-chip__item` rows linking to the target verses.
 */
test.describe('parallel chip (verse-page parallels disclosure)', () => {
  const VERSE_URL = '/trika/siva-sutras/1/1';

  test('chip is hidden when the verse has no parallels', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('networkidle');

    // The chip element must not be present in the DOM at all when count=0
    // — it's the only honest UI for "zero parallels found". An empty
    // disclosure with "(0)" would be misleading.
    const chip = page.locator('.parallels-chip');
    await expect(chip).toHaveCount(0);
  });

  test('verse page renders without the chip in the chips slot', async ({ page }) => {
    await page.goto(VERSE_URL);
    await page.waitForLoadState('networkidle');

    // The chips slot still exists (AI-assist badges live there) — we're
    // asserting it just doesn't include a parallels chip. Assert DOM
    // presence with toHaveCount(1) rather than toBeVisible(): when the
    // slot has no children it collapses to a 0×0 box (see
    // VerseAnatomy.astro:94 — `<div class="verse-chips">` is always
    // rendered as a flex container with no `:empty` rule), which
    // Playwright reports as hidden even though the element exists.
    const chipsSlot = page.locator('.verse-chips');
    await expect(chipsSlot).toHaveCount(1);
    await expect(chipsSlot.locator('.parallels-chip')).toHaveCount(0);
  });
});
