/**
 * AIAssistedBadge state resolver — pure helper.
 *
 * Resolves the locked state matrix from translation provenance props
 * into the visual variant + label + icon used by `AIAssistedBadge.astro`.
 *
 * Kept as a standalone pure function so it can be unit-tested directly
 * without rendering Astro components. The Astro component imports this
 * and the unit tests import this — single source of truth.
 *
 * State matrix:
 *   - aiAssisted=true,  status='reviewed' → emerald "AI · reviewed by {name}"
 *                                                (or "AI · reviewed" if no name)
 *   - aiAssisted=true,  any other status  → amber   "AI · not verified"
 *   - aiAssisted=false, any status        → slate   "{translator} · {year} · PD"
 *                                                (drops " · PD" if translator
 *                                                already encodes PD/public-domain)
 *   - aiAssisted=false, no translator     → slate   "Public domain"
 */

export type BadgeStatus = 'draft' | 'reviewed' | 'published';
export type BadgeVariant = 'amber' | 'emerald' | 'slate';

export interface BadgeStateInput {
  aiAssisted: boolean;
  status: BadgeStatus;
  translator?: string | null;
  year?: number | string | null;
  reviewerName?: string | null;
}

export interface BadgeState {
  variant: BadgeVariant;
  label: string;
  icon: string;
}

export function computeBadgeState(input: BadgeStateInput): BadgeState {
  const { aiAssisted, status, translator, year, reviewerName } = input;

  if (aiAssisted && status === 'reviewed') {
    return {
      variant: 'emerald',
      label: reviewerName ? `AI · reviewed by ${reviewerName}` : 'AI · reviewed',
      icon: '✓',
    };
  }

  if (aiAssisted) {
    // Covers status='published' and the 'draft' fallback if it ever surfaces.
    return {
      variant: 'amber',
      label: 'AI · not verified',
      icon: 'AI',
    };
  }

  // aiAssisted = false → slate
  const t = translator?.trim() || 'Public domain';
  const tIsPdSelf = /\bpd\b|public[\s-]?domain/i.test(t);
  const parts: string[] = [t];
  if (year !== null && year !== undefined && year !== '') parts.push(String(year));
  if (!tIsPdSelf) parts.push('PD');
  return {
    variant: 'slate',
    label: parts.join(' · '),
    icon: 'PD',
  };
}
