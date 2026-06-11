/**
 * youtube/composition/Devanagari.tsx
 *
 * Large, centered on-screen Sanskrit. Uses `preset.devanagariFont`
 * (Noto Serif Devanagari) so HarfBuzz shapes conjuncts/matras correctly.
 * This glyph stream is rendered, never spoken.
 */
import type React from 'react';

export type DevanagariProps = {
  text: string;
  font: string;
  color: string;
  opacity?: number;
  fontSize?: number;
};

export const Devanagari: React.FC<DevanagariProps> = ({
  text,
  font,
  color,
  opacity = 1,
  fontSize = 132,
}) => {
  return (
    <div
      style={{
        fontFamily: `"${font}", serif`,
        fontSize,
        lineHeight: 1.25,
        fontWeight: 600,
        color,
        textAlign: 'center',
        padding: '0 120px',
        opacity,
        // Long Sanskrit compounds (samāsa) are single unbreakable "words" that
        // can exceed the 1080px width and clip at the screen edges. Allow them
        // to wrap rather than overflow — readability beats perfect line breaks.
        overflowWrap: 'anywhere',
        wordBreak: 'break-word',
        // Devanagari shaping depends on the woff2 face being registered;
        // see fonts.ts loadFonts().
        fontFeatureSettings: '"kern" 1, "liga" 1',
      }}
      lang="sa"
    >
      {text}
    </div>
  );
};
