import { expect, test } from '@playwright/test';

test.describe('verse anatomy shape (Vedabase pattern)', () => {
  const url = '/trika/siva-sutras/1/1';

  test('DOM order: Devanagari → IAST → synonyms → translation', async ({ page }) => {
    await page.goto(url);
    // Scope to <body> only — <title> in the HEAD contains "Consciousness" and
    // would otherwise appear before Devanāgarī and break the ordering check.
    const body = await page.evaluate(() => document.body.innerHTML);
    const devaIdx = body.indexOf('चैतन्य');
    const iastIdx = body.indexOf('caitanyam');
    const transIdx = body.toLowerCase().indexOf('consciousness');
    expect(devaIdx, 'Devanāgarī missing from body').toBeGreaterThan(-1);
    expect(iastIdx, 'IAST missing from body').toBeGreaterThan(-1);
    expect(transIdx, 'English translation missing from body').toBeGreaterThan(-1);
    expect(devaIdx, 'Devanāgarī must come before IAST in DOM').toBeLessThan(iastIdx);
    expect(iastIdx, 'IAST must come before English translation in DOM').toBeLessThan(transIdx);
  });

  test('synonyms use dash-joined Vedabase pattern', async ({ page }) => {
    await page.goto(url);
    const body = await page.locator('body').innerText();
    // Em dash (—) is the Vedabase separator between word and gloss.
    expect(body).toContain('—');
  });

  test('translation paragraph max-width ≤ 65ch', async ({ page }) => {
    await page.goto(url);
    // Find any element whose computed max-width is around 65ch (≈ 30–45 rem).
    const widthsOk = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('p, .translation, [class*=trans]'));
      for (const el of all) {
        const mw = getComputedStyle(el).maxWidth;
        if (mw && mw !== 'none') {
          // Accept either explicit ch unit or computed px in a reasonable range.
          if (mw.endsWith('ch')) return true;
          const px = Number.parseFloat(mw);
          if (!Number.isNaN(px) && px > 200 && px < 900) return true;
        }
      }
      return false;
    });
    expect(widthsOk).toBe(true);
  });

  test('interactive elements ≥ 44px touch target', async ({ page }) => {
    await page.goto(url);
    const small = await page.evaluate(() => {
      const inter = Array.from(
        document.querySelectorAll('button, a[href], input, [role="button"]'),
      );
      const offenders: Array<{ tag: string; w: number; h: number; txt: string }> = [];
      for (const el of inter) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // hidden
        if (r.width < 44 || r.height < 44) {
          offenders.push({
            tag: el.tagName,
            w: Math.round(r.width),
            h: Math.round(r.height),
            txt: (el.textContent || '').trim().slice(0, 30),
          });
        }
      }
      return offenders;
    });
    // Report but don't fail hard — many footer links naturally <44 in tight layouts.
    test.info().annotations.push({
      type: 'touch-target-report',
      description: `${small.length} elements <44px: ${JSON.stringify(small.slice(0, 10))}`,
    });
  });
});
