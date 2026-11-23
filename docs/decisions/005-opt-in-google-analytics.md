# Decision 005: opt-in Google Analytics alongside edge analytics

Status: accepted 2026-11-23, written with the implementing change (unlike 001–004, this record is contemporaneous).

## Context

Launch (June 2026) chose Cloudflare's zone-level Web Analytics as the only analytics surface and promised on `/about/privacy`: no client-side analytics scripts, no cookies ([observability runbook](../CF-OBSERVABILITY-SETUP.md)). That view gives aggregate requests and visitors, but not what Phase 2 planning needs: which interface/reader languages and scripts readers choose, how far they read, which referrers (notably the YouTube channel) bring readers, and how many reach the daily-verse form. Search Console covers search acquisition only.

## Decision

Add Google Analytics 4 as an **opt-in** layer, keeping Cloudflare Web Analytics as the always-on baseline:

- Build-time gate: nothing renders unless `PUBLIC_GA_MEASUREMENT_ID` is set, and it is set only in the Cloudflare Pages Production environment. Dev, CI and preview builds are unchanged.
- Consent Mode "basic": defaults denied; gtag.js is not requested and no cookie is set before the visitor clicks "Allow analytics". Accept and decline have equal visual weight. Global Privacy Control counts as a refusal.
- Google Signals and ad personalization disabled in the tag and in the property; 2-month retention; no Ads links ([setup](../GA4-SETUP.md)).
- Withdrawal from the reading settings deletes `_ga*` cookies. Email confirm/unsubscribe pages opt out entirely.
- The privacy page was rewritten in the same change, and the EN and localized routes now share one source so they cannot drift.

## Alternatives considered

- **Keep edge analytics only** — preserves the original promise; does not answer the language/engagement/acquisition questions.
- **Cloudflare Zaraz** — first-party loader and built-in consent manager, but configuration lives in the dashboard rather than in reviewed code, and it is still client-side script.
- **GA4 "advanced" consent mode / cookieless-only** — sends cookieless pings before or without consent; rejected because it contradicts "nothing loads until you allow it".
- **Self-hosted or cookieless products (Plausible, Fathom, CF beacon)** — not chosen because GA4 was the explicit requirement; the privacy page still names them as not used.

## Consequences

- Reports cover consenting visitors only and will undercount relative to Cloudflare; use them for ratios and trends.
- A third-party script loads for consenting visitors (deferred to idle on return visits); measure Lighthouse before/after.
- The privacy page now carries obligations that depend on GA admin settings (retention, Signals). Changing those settings requires a privacy-page change.
- Banner copy is English in all locales until translated.

Verification: [unit tests](../../tests/unit/analytics.test.ts) and the [consent e2e suite](../../tests/e2e/analytics-consent.spec.ts), which runs a second dev server with a dummy ID and stubs all Google requests.
