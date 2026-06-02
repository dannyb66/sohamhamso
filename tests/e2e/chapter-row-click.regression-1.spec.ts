// Regression: design audit 2026-06-01 #11 — chapter list rows had a
// tap target the size of the "Read chapter N →" text only. On mobile
// this is a fat-finger trap. Fix: the table was replaced with a <ul>
// of full-row anchors so the whole row (chapter # + verse count +
// CTA text) is one tap target. Audit screenshot:
// .gstack/design/screenshots/06-spanda-overview-mobile.png.

import { expect, test } from '@playwright/test';

const OVERVIEW = '/trika/spanda-karikas';

test.describe('audit 2026-06-01 #11 — chapter row is fully clickable', () => {
  test('every row is wrapped in a single anchor pointing to chapter/1', async ({
    page,
  }) => {
    await page.goto(OVERVIEW);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('a.chapter-row__link');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    // Each row's href ends in /1 (chapter-1 entrypoint).
    for (let i = 0; i < count; i++) {
      const href = await rows.nth(i).getAttribute('href');
      expect(href).toMatch(/\/trika\/spanda-karikas\/\d+\/1$/);
    }
  });

  test('clicking the chapter-number cell (far left of the row) navigates', async ({
    page,
  }) => {
    await page.goto(OVERVIEW);
    await page.waitForLoadState('networkidle');

    // Far-left of the first data row, inside the chapter-number column.
    // Before the fix this cell was a non-clickable <td>. After the fix
    // the entire row is an <a>, so clicking anywhere in it navigates.
    const firstRow = page.locator('a.chapter-row__link').first();
    const numCol = firstRow.locator('.chapter-row__col-num');
    await expect(numCol).toBeVisible();
    await numCol.click();

    await page.waitForURL(/\/trika\/spanda-karikas\/\d+\/1$/, { timeout: 5_000 });
    expect(page.url()).toMatch(/\/trika\/spanda-karikas\/\d+\/1$/);
  });

  test('row has min-height ≥ 44px (WCAG 2.5.5 tap target)', async ({
    page,
  }) => {
    await page.goto(OVERVIEW);
    const firstRow = page.locator('a.chapter-row__link').first();
    const box = await firstRow.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
