/**
 * Breadcrumbs.astro tests.
 *
 * Astro's `experimental_AstroContainer` cannot render `.astro` files in this
 * project's vitest config (no astro vite plugin wired into the test env, and
 * adding it is out of scope per the audit). We fall back to two complementary
 * strategies — both load-bearing:
 *
 *  1. Pure-helper unit tests on `buildBreadcrumbAriaProps` (the
 *     classification logic the component actually imports and calls).
 *  2. Raw-source regex assertions on `Breadcrumbs.astro` to pin the visible
 *     markup contract (nav landmark, list shape, helper wiring).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBreadcrumbAriaProps } from '../../../src/components/seo/breadcrumb-utils';

const BREADCRUMB_ASTRO_PATH = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'components',
  'seo',
  'Breadcrumbs.astro',
);

describe('buildBreadcrumbAriaProps', () => {
  const items = [
    { name: 'Home', href: '/' },
    { name: 'shaiva', href: '/shaiva' },
    { name: 'Vijñāna Bhairava Tantra', href: '/shaiva/vijnana-bhairava-tantra' },
    { name: '1.47' },
  ];

  it('classifies the first three items as linked, non-current', () => {
    for (let idx = 0; idx < 3; idx++) {
      const props = buildBreadcrumbAriaProps(items[idx]!, idx, items.length);
      expect(props.isLast).toBe(false);
      expect(props.asLink).toBe(true);
      expect(props.ariaCurrent).toBeUndefined();
    }
  });

  it('classifies the last item as current page, never as a link, even if href is present', () => {
    const props = buildBreadcrumbAriaProps(items[3]!, 3, items.length);
    expect(props.isLast).toBe(true);
    expect(props.asLink).toBe(false);
    expect(props.ariaCurrent).toBe('page');

    // Last item with href must still render as span (current page is not a link)
    const withHref = buildBreadcrumbAriaProps(
      { name: 'X', href: '/x' },
      1,
      2,
    );
    expect(withHref.asLink).toBe(false);
    expect(withHref.ariaCurrent).toBe('page');
  });

  it('renders an item without href as a span at non-last positions', () => {
    const props = buildBreadcrumbAriaProps({ name: 'Orphan' }, 1, 4);
    expect(props.isLast).toBe(false);
    expect(props.asLink).toBe(false);
    expect(props.ariaCurrent).toBeUndefined();
  });

  it('treats a single-item breadcrumb as the current page', () => {
    const props = buildBreadcrumbAriaProps({ name: 'Home', href: '/' }, 0, 1);
    expect(props.isLast).toBe(true);
    expect(props.asLink).toBe(false);
    expect(props.ariaCurrent).toBe('page');
  });
});

describe('Breadcrumbs.astro source contract', () => {
  const source = readFileSync(BREADCRUMB_ASTRO_PATH, 'utf8');

  it('imports and uses the buildBreadcrumbAriaProps helper', () => {
    expect(source).toMatch(/from ['"]\.\/breadcrumb-utils['"]/);
    expect(source).toMatch(/buildBreadcrumbAriaProps\(item, idx, items\.length\)/);
  });

  it('renders a Breadcrumb-labelled nav landmark wrapping an ordered list', () => {
    expect(source).toMatch(/<nav[^>]*aria-label="Breadcrumb"/);
    expect(source).toMatch(/<ol class="breadcrumb-list">/);
    expect(source).toMatch(/<li class="breadcrumb-item">/);
  });

  it('guards against rendering when items is empty', () => {
    expect(source).toMatch(/showNav\s*=\s*items\?\.length\s*>\s*0/);
    expect(source).toMatch(/\{showNav\s*&&/);
  });

  it('branches link vs span on the helper output', () => {
    expect(source).toMatch(/\{asLink \?/);
    expect(source).toMatch(/aria-current=\{ariaCurrent\}/);
  });
});
