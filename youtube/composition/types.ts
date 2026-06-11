/**
 * youtube/composition/types.ts
 *
 * Pure-TypeScript contract for the Remotion composition. Lives in its own
 * file (no `react`/`remotion`/JSX imports) so non-Remotion code — e.g.
 * `pipeline/youtube/remotion-props.ts` — can import the `ShortProps` type
 * without dragging the React `.tsx` graph into the project's Solid-JSX
 * typecheck. The `.tsx` components re-import these types from here.
 */

export type ShortPreset = {
  bg: string;
  accent: string;
  text: string;
  headlineFont: string;
  bodyFont: string;
  devanagariFont: string;
  footerLine: string;
};

export type ShortProps = {
  textTitle: string; // "Śiva Sūtra"
  reference: string; // "1.1"
  devanagari: string; // "चैतन्यमात्मा"
  iast: string; // "caitanyam ātmā"
  translation: string; // English translation
  preset: ShortPreset;
  audioSrc: string | null; // narration file/URL; render silence if null
  audioStartFrame: number; // frame the English appears AND narration begins
  fps: number; // 30
  durationInFrames: number; // dynamic: leadIn + narration + tail (per verse)
};
