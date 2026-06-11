/**
 * youtube/composition/Translation.tsx
 *
 * English translation in the body font (EB Garamond), wrapping naturally,
 * colored with `preset.text`. This is the line the narration speaks aloud.
 */
import type React from 'react';

export type TranslationProps = {
  translation: string;
  font: string;
  color: string;
  opacity?: number;
  fontSize?: number;
  /**
   * Text measure (content-box width), px. Default = the portrait value —
   * CASCADE GUARD: the Short composition's output stays byte-identical
   * (see template-version.test.ts). The landscape Chapter passes ~1400.
   */
  maxWidth?: number;
};

export const Translation: React.FC<TranslationProps> = ({
  translation,
  font,
  color,
  opacity = 1,
  fontSize = 56,
  maxWidth = 820,
}) => {
  return (
    <div
      style={{
        fontFamily: `"${font}", serif`,
        fontSize,
        lineHeight: 1.5,
        fontWeight: 400,
        color,
        textAlign: 'center',
        maxWidth,
        padding: '0 80px',
        opacity,
        textWrap: 'balance',
      }}
      lang="en"
    >
      {translation}
    </div>
  );
};
