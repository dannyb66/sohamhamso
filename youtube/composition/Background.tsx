/**
 * youtube/composition/Background.tsx
 *
 * Full-frame solid background driven entirely by `preset.bg`. No hardcoded
 * branding — every visual value comes from props so a preset change cascades
 * to the render. A single hairline accent rule near the top gives the frame a
 * "manuscript leaf" register without ornament.
 */
import type React from 'react';
import { AbsoluteFill } from 'remotion';

export type BackgroundProps = {
  bg: string;
  accent: string;
};

export const Background: React.FC<BackgroundProps> = ({ bg, accent }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      {/* subtle aged-gold rule, low opacity so it reads as a margin line */}
      <div
        style={{
          position: 'absolute',
          top: 260,
          left: 140,
          right: 140,
          height: 2,
          backgroundColor: accent,
          opacity: 0.28,
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 260,
          left: 140,
          right: 140,
          height: 2,
          backgroundColor: accent,
          opacity: 0.28,
        }}
      />
    </AbsoluteFill>
  );
};
