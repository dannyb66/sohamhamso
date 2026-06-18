/**
 * youtube/composition/Footer.tsx
 *
 * Persistent bottom strip: "<textTitle> <reference>" on the left,
 * `preset.footerLine` on the right. Small, accent color, no hardcoded branding
 * (footer line comes from the preset).
 *
 * Parameterized for the landscape Chapter composition (padding override, a
 * right-slot text override for "Verse i of M", and a crossfade opacity hook
 * for the per-verse reference swap). CASCADE GUARD: every default is EXACTLY
 * the previous hardcoded portrait behavior, so the Short composition's
 * rendered output stays byte-identical and shorts TEMPLATE_VERSION is NOT
 * bumped (documented exemption — see template-version.test.ts).
 */
import type React from 'react';
import { AbsoluteFill } from 'remotion';

export type FooterProps = {
  textTitle: string;
  reference: string;
  footerLine: string;
  font: string;
  accent: string;
  /** Strip padding. Default = portrait value. */
  padding?: string;
  /** Right-slot text. Defaults to `footerLine` (the Short behavior). */
  rightText?: string;
  /**
   * Opacity multiplier on the per-verse parts (reference + right slot) so
   * the Chapter composition can crossfade them at segment boundaries.
   * Default 1 (no effect — Short behavior unchanged).
   */
  referenceOpacity?: number;
};

export const Footer: React.FC<FooterProps> = ({
  textTitle,
  reference,
  footerLine,
  font,
  accent,
  padding = '0 120px 110px 120px',
  rightText,
  referenceOpacity = 1,
}) => {
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 32,
          padding,
          fontFamily: `"${font}", serif`,
          fontSize: 30,
          letterSpacing: '0.02em',
          color: accent,
          opacity: 0.92,
          // Keep the strip to a single line — long text/lineage labels must
          // truncate, never wrap up into the verse content above.
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ fontWeight: 600, flex: '0 0 auto' }}>
          {textTitle} <span style={{ opacity: referenceOpacity }}>{reference}</span>
        </span>
        <span
          style={{
            fontStyle: 'italic',
            flex: '0 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            opacity: referenceOpacity,
          }}
        >
          {rightText ?? footerLine}
        </span>
      </div>
    </AbsoluteFill>
  );
};
