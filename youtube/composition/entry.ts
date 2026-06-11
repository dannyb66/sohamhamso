/**
 * youtube/composition/entry.ts
 *
 * The Remotion BUNDLE ENTRY POINT. `@remotion/bundler` validates that the
 * entry file contains a `registerRoot()` call and throws otherwise — so this
 * file MUST call it. Kept deliberately separate from `index.ts` (the type /
 * component re-export barrel that node/test code imports): importing the
 * package surface in a non-render context must not trigger `registerRoot`.
 *
 * `render-engine.ts` passes THIS file as `bundle({ entryPoint })`.
 */
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
