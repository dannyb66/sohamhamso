import { expect, test } from '@playwright/test';

for (const locale of ['', '/hi', '/ta']) {
  test(`generated corpus serves Spanda 1.1 in ${locale || 'English'}`, async ({ request }) => {
    const response = await request.get(`${locale}/trika/spanda-karikas/1/1`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain('word-by-word synonyms');
    expect(html).not.toContain('The reader is briefly unavailable');
    expect(html).toContain('spanda-karikas/1/1');
  });
}

test('an unknown chapter remains a genuine 404', async ({ request }) => {
  const response = await request.get('/trika/spanda-karikas/999/1');
  expect(response.status()).toBe(404);
});
