/**
 * youtube/composition/Transliteration.tsx
 *
 * IAST line in italic headline font (EB Garamond), accent color. EB Garamond
 * carries the full pre-composed diacritic set (ā ī ū ṛ ḷ ṃ ḥ ś ṣ ṭ ḍ ṇ).
 */
import type React from 'react';

export type TransliterationProps = {
  iast: string;
  font: string;
  color: string;
  opacity?: number;
  fontSize?: number;
};

export const Transliteration: React.FC<TransliterationProps> = ({
  iast,
  font,
  color,
  opacity = 1,
  fontSize = 64,
}) => {
  return (
    <div
      style={{
        fontFamily: `"${font}", serif`,
        fontStyle: 'italic',
        fontSize,
        lineHeight: 1.3,
        fontWeight: 500,
        letterSpacing: '0.01em',
        color,
        textAlign: 'center',
        padding: '0 140px',
        opacity,
      }}
      lang="sa-Latn"
    >
      {iast}
    </div>
  );
};
