/**
 * youtube/composition/OutroCard.tsx
 *
 * Closing card for the Chapter composition (~9s, design decision #14):
 * a short human-readable URL plus ONE intent line. Content sits in the
 * upper-left two-thirds of the frame — the right third and lower third are
 * kept visually quiet so YouTube end-screen overlays (subscribe + next
 * chapter cards, configured per video in Studio) have room.
 */
import type React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import type { ShortPreset } from './types';

export type OutroCardProps = {
  /** Short human-readable URL (UTM lives in the video description). */
  outroUrl: string;
  preset: ShortPreset;
};

function fadeIn(frame: number, start: number, dur = 18): number {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

export const OutroCard: React.FC<OutroCardProps> = ({ outroUrl, preset }) => {
  const frame = useCurrentFrame();

  const urlOpacity = fadeIn(frame, 8);
  const lineOpacity = fadeIn(frame, 26);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Upper-left two-thirds only — end-screen safe zone stays empty. */}
      <div
        style={{
          position: 'absolute',
          top: 300,
          left: 240,
          width: 1040,
          display: 'flex',
          flexDirection: 'column',
          gap: 36,
        }}
      >
        <div
          style={{
            fontFamily: `"${preset.headlineFont}", serif`,
            fontSize: 64,
            fontWeight: 600,
            letterSpacing: '0.01em',
            color: preset.accent,
            opacity: urlOpacity,
          }}
        >
          {outroUrl}
        </div>
        <div
          style={{
            fontFamily: `"${preset.bodyFont}", serif`,
            fontSize: 40,
            lineHeight: 1.5,
            color: preset.text,
            opacity: lineOpacity,
          }}
        >
          Read every verse with word-by-word glosses
        </div>
      </div>
    </AbsoluteFill>
  );
};
