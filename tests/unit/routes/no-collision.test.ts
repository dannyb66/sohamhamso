import { describe, expect, it } from 'vitest';
import { NON_ENGLISH_LANGS } from '../../../src/lib/seo';
import { getCanonicalVerseRoutes } from '../../../src/lib/seo/corpus-bundle';

describe('localized route collision guard', () => {
  it('localized verse routes never intersect canonical root verse routes', () => {
    const rootPaths = new Set(
      getCanonicalVerseRoutes().map(
        (route) => `/${route.tradition}/${route.text}/${route.chapter}/${route.verse}`,
      ),
    );
    const localizedPaths = new Set(
      NON_ENGLISH_LANGS.flatMap((lang) =>
        getCanonicalVerseRoutes().map(
          (route) => `/${lang}/${route.tradition}/${route.text}/${route.chapter}/${route.verse}`,
        ),
      ),
    );

    for (const path of localizedPaths) {
      expect(rootPaths.has(path)).toBe(false);
    }
  });
});
