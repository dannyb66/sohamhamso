/**
 * youtube/composition/Background.tsx
 *
 * Full-frame solid background driven entirely by `preset.bg`. No hardcoded
 * branding — every visual value comes from props so a preset change cascades
 * to the render. A single hairline accent rule near the top gives the frame a
 * "manuscript leaf" register without ornament.
 *
 * Rule geometry is parameterized for the landscape Chapter composition.
 * CASCADE GUARD: the defaults are EXACTLY the previous hardcoded portrait
 * values, so the Short composition's rendered output stays byte-identical
 * and shorts TEMPLATE_VERSION is NOT bumped (documented exemption — see
 * tests/unit/youtube/template-version.test.ts).
 */
import type React from 'react';
import { AbsoluteFill } from 'remotion';

export type BackgroundProps = {
  bg: string;
  accent: string;
  /** Top rule offset from the frame top, px. Default = portrait value. */
  ruleTop?: number;
  /** Bottom rule offset from the frame bottom, px. Default = portrait value. */
  ruleBottom?: number;
  /** Horizontal inset of both rules, px. Default = portrait value. */
  ruleInsetX?: number;
};

export const Background: React.FC<BackgroundProps> = ({
  bg,
  accent,
  ruleTop = 260,
  ruleBottom = 260,
  ruleInsetX = 140,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      {/* subtle aged-gold rule, low opacity so it reads as a margin line */}
      <div
        style={{
          position: 'absolute',
          top: ruleTop,
          left: ruleInsetX,
          right: ruleInsetX,
          height: 2,
          backgroundColor: accent,
          opacity: 0.28,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: ruleBottom,
          left: ruleInsetX,
          right: ruleInsetX,
          height: 2,
          backgroundColor: accent,
          opacity: 0.28,
        }}
      />
    </AbsoluteFill>
  );
};
