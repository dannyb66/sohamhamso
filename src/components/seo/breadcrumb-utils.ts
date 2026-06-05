/**
 * Pure render-props builder for Breadcrumbs.astro.
 *
 * Extracted so the classification logic (last-item detection, link vs span,
 * aria-current marker) can be unit-tested without spinning up an Astro
 * container in vitest. The component must import and call this helper —
 * see Breadcrumbs.astro.
 */

export interface BreadcrumbItem {
  name: string;
  href?: string;
}

export interface BreadcrumbRenderProps {
  isLast: boolean;
  asLink: boolean;
  ariaCurrent: 'page' | undefined;
}

export function buildBreadcrumbAriaProps(
  item: BreadcrumbItem,
  index: number,
  total: number,
): BreadcrumbRenderProps {
  const isLast = index === total - 1;
  return {
    isLast,
    asLink: Boolean(item.href) && !isLast,
    ariaCurrent: isLast ? 'page' : undefined,
  };
}
