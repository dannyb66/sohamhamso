/**
 * youtube/composition/Footer.tsx
 *
 * Persistent bottom strip: "<textTitle> <reference>" on the left,
 * `preset.footerLine` on the right. Small, accent color, no hardcoded branding
 * (footer line comes from the preset).
 */
import type React from 'react';
import { AbsoluteFill } from 'remotion';

export type FooterProps = {
  textTitle: string;
  reference: string;
  footerLine: string;
  font: string;
  accent: string;
};

export const Footer: React.FC<FooterProps> = ({
  textTitle,
  reference,
  footerLine,
  font,
  accent,
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
          padding: '0 120px 110px 120px',
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
          {textTitle} {reference}
        </span>
        <span
          style={{
            fontStyle: 'italic',
            flex: '0 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {footerLine}
        </span>
      </div>
    </AbsoluteFill>
  );
};
