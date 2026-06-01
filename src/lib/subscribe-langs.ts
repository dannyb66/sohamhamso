// Single source of truth for which languages the daily-verse subscribe
// endpoint accepts.
//
// V1.0 ships English only. The Resend send Worker, region-pinning, and
// EU/US delivery contracts are all wired for one language at launch.
// Indic languages are queued — translation content exists in the corpus
// (the READER picker offers all 12) but the SUBSCRIBE pipeline cannot
// honor a Hindi-only / Tamil-only / etc. daily-verse delivery yet.
//
// Both the API (src/pages/api/subscribe.ts) and the SubscribeBand UI
// (src/components/SubscribeBand.astro) import from here. The picker
// renders non-ACTIVE langs as disabled with a "(soon)" suffix; the API
// rejects them with HTTP 400 + a friendly message. The two MUST stay
// in sync — out-of-sync state lands a real user on a dead-end submit.
//
// As more languages come online, add them to ACTIVE_LANGUAGES here.
// Both surfaces auto-pick up the change with no other edits.
export const ACTIVE_LANGUAGES: ReadonlySet<string> = new Set(['en']);

export const KNOWN_LANGUAGES: ReadonlySet<string> = new Set([
  'en',
  'hi',
  'ta',
  'te',
  'bn',
  'mr',
  'gu',
  'kn',
  'ml',
  'pa',
  'or',
  'as',
]);
