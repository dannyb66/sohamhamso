# Google Analytics 4 — opt-in setup

Operator runbook for the consent-first GA4 integration. Decision and
trade-offs: [decision 005](decisions/005-opt-in-google-analytics.md).
Public promise: [`/about/privacy#analytics`](../src/components/PrivacyArticle.astro).

Cloudflare's zone-level Web Analytics ([setup](CF-OBSERVABILITY-SETUP.md))
stays on as the always-on, cookieless baseline. GA4 only sees visitors
who choose "Allow analytics", so the two will never agree on totals —
compare trends, not absolute counts.

## How it works

| Piece | File | Behaviour |
|---|---|---|
| Build-time gate | [`Analytics.astro`](../src/components/Analytics.astro) | Renders nothing unless `PUBLIC_GA_MEASUREMENT_ID` is a valid `G-…` ID **at build time** and the page did not pass `analytics={false}` |
| Banner + runtime | [`AnalyticsConsent.astro`](../src/components/AnalyticsConsent.astro), [`analytics-client.ts`](../src/lib/analytics-client.ts) | Consent Mode defaults all `denied`; gtag.js is requested only after consent ("basic" mode). Global Privacy Control = refusal, banner never shown |
| Pure helpers | [`analytics.ts`](../src/lib/analytics.ts) | ID validation, consent parsing, page classification (unit tested) |
| Withdrawal | [`SettingsSheet.solid.tsx`](../src/components/SettingsSheet.solid.tsx) | "Allow Google Analytics" checkbox; unchecking sets `ga-disable-<ID>`, updates consent to denied and deletes `_ga*` cookies |
| Opted-out pages | `confirmed.astro`, `unsubscribed.astro` | `analytics={false}` — email flows stay untracked |

Choice is stored in `localStorage['sohamhamso:analytics-consent']`
(`granted` / `denied`). Clearing site data re-asks.

## 1. Create the property (one-time, Google account owner)

UI labels as of November 2026; Google renames menus occasionally.

1. <https://analytics.google.com> → **Admin** → **Create** → **Property**.
   Name `sohamhamso.org`, reporting time zone of your choice, currency
   irrelevant. Business details: smallest size; objective "Understand web
   traffic" (does not change collection).
2. **Data streams** → **Add stream** → **Web** →
   `https://sohamhamso.org`, stream name `sohamhamso.org`.
   Keep **Enhanced measurement** on (page views, scrolls, outbound clicks,
   site search, file downloads). Under its settings, confirm site search
   uses query parameter `q` (the default list includes it).
   Turn **off** "Form interactions" — it would duplicate
   `subscribe_submit` and fires on the search form.
3. Copy the **Measurement ID** (`G-…`).

## 2. Privacy settings (do these before collecting data)

The privacy page states each of these — keep them in sync.

| Setting | Path | Value |
|---|---|---|
| Data retention | Admin → Data collection and modification → Data retention | **2 months** (event + user data); "Reset user data on new activity" off |
| Google signals | Admin → Data collection and modification → Data collection | **Off** |
| Granular location and device data | same page | Off for all regions if you do not need city-level/device-model detail (optional; privacy page says "approximate location") |
| Ads personalization | same page | Off for all regions |
| Product links | Admin → Product links | **No** Google Ads / Merchant / BigQuery links. Search Console link is fine (no visitor data flows to it) |
| Account data sharing | Admin → Account settings | All "Data sharing settings" unchecked |

The tag also sends `allow_google_signals: false` and
`allow_ad_personalization_signals: false`, so a misclicked admin toggle
does not re-enable them for this site.

## 3. Custom definitions

Admin → Data display → **Custom definitions** → **Create custom dimension**,
scope **Event**. Parameter names must match
[`analytics-client.ts`](../src/lib/analytics-client.ts) exactly.

| Dimension name | Event parameter | Source |
|---|---|---|
| Page language | `page_lang` | `<html lang>` (URL locale) |
| Reader language | `reader_lang` | Reader-language choice (Settings / reading mode) |
| Reading script | `reading_script` | Script choice (`default` if never changed) |
| Tradition | `tradition` | Reader pages: first path segment after locale |
| Text | `text_slug` | Reader pages: second path segment |
| Parallel translations | `parallel_langs` | Comma list on `parallel_translations_change` |
| Subscribe language | `subscribe_lang` | On `subscribe_submit` |

Custom metric (scope Event, unit Standard): `parallel_count`.

`content_group` (`home`, `reader`, `about`, `texts`, `lemma`, `search`,
…) is GA4's built-in **Content group** dimension — no registration needed.

Custom dimensions only populate from the moment they are registered.

The runtime attaches these parameters to each event it sends: a
`page_context` event once per page load, and the custom events below.
The Google tag for this property is served as a Tag Manager container
(GTM-57NMP95W). Verified on 2026-11-23, it sends `page_view` itself and
ignores on-page `gtag('set', …)` values and extra `config` fields
(including `send_page_view: false`), so `page_view` and the
enhanced-measurement events (`scroll`, `click`, `view_search_results`,
`file_download`) carry **no** custom dimensions. For "views by
language/text/tradition", report on the `page_context` event count, not
`page_view`. Signals and ad personalization are enforced by the property
settings above, not by the tag's `config` flags.

Live property (created 2026-11-23): account `sohamhamso` (417276167),
property `sohamhamso.org` (565584164), web stream measurement ID
`G-RYTJWE8GEJ`, owned by the deepakbasavaraju7 Google account.

## 4. Events

| Event | When |
|---|---|
| `page_view`, `scroll`, `user_engagement`, `view_search_results`, `click` | Enhanced measurement (automatic) |
| `page_context` | Once per page load after consent; carries all page dimensions (use it, not `page_view`, for per-dimension view counts) |
| `reader_lang_change` | Reader language / reading mode changed (carries updated `reader_lang`, `reading_script`) |
| `parallel_translations_change` | Parallel-translation drawer selection changed |
| `settings_open` | Reading settings sheet opened |
| `subscribe_submit` | Daily-verse form submitted (no address; double opt-in means this is not a confirmed subscriber) |

Mark `subscribe_submit` as a **Key event** (Admin → Data display →
Events). Confirmed subscribers remain countable only from D1 via the
[demand dashboard](../.github/workflows/demand-dashboard.yml).

## 5. Exclude your own traffic

Admin → Data streams → stream → **Configure tag settings** → **Define
internal traffic** → add your IP(s). Then Admin → Data collection and
modification → **Data filters** → set "Internal Traffic" to **Active**
(it starts in Testing).

## 6. Wire the ID into production

1. Cloudflare dashboard → Workers & Pages → `sohamhamso` → Settings →
   **Variables and Secrets** → **Production** → add
   `PUBLIC_GA_MEASUREMENT_ID = G-…` (plain text; it is public in the page
   source by design) — the same place the build-time `LOCALE_URLS_LIVE`
   variable lives. **Do not** add it to Preview — preview deployments
   must stay silent.
   This repo has a `wrangler.toml` with `pages_build_output_dir`, which can
   make Wrangler the source of truth for Pages settings. If the dashboard
   shows variables as read-only, put the ID under
   `[env.production.vars]` in `wrangler.toml` instead, and confirm in the
   build log that the value reached `astro build`. Step 7.1 catches a
   miss: no banner means the ID was not inlined.
2. Retry the latest production deployment (or merge any commit to
   `main`). The value is inlined at **build** time, so changing it always
   needs a rebuild.

## 7. Verify after deploy

1. Open <https://sohamhamso.org> in a private window: banner visible;
   DevTools → Network shows **no** `googletagmanager.com` request and
   Application → Cookies shows no `_ga*`.
2. Click "Allow analytics": `gtag/js?id=G-…` loads, `_ga` and `_ga_…`
   cookies appear, GA4 **Realtime** shows the visit within ~1 minute.
   Use **Tag Assistant** (<https://tagassistant.google.com>) for
   DebugView.
3. Reading settings (**Aa**) → clear "Allow Google Analytics": `_ga*`
   cookies disappear; further navigation sends no `collect` requests.
4. `/confirmed` and `/unsubscribed`: no banner, no Google requests.
5. Lighthouse (mobile) on `/` and one verse page, before vs. after
   consent; record numbers with date and commit in
   [operations](OPERATIONS-AND-QUALITY.md) if they move.

## Rollback

Delete `PUBLIC_GA_MEASUREMENT_ID` from the Production environment and
redeploy: every page renders without banner or runtime. Visitors' stored
choices are inert without the runtime. Update the privacy page in the
same change if analytics is removed for good.

## Known limitations

- Site search: the query is part of the `/search?q=…` page URL and is
  also reported as `search_term`; the privacy page discloses this. Turn
  off site search in Enhanced measurement (and strip `q` from
  `page_location`) if that becomes unwanted.
- `content_group` is path-based: 404s for unknown paths are grouped as
  `reader` with whatever the first segment was.
- If localStorage is blocked, the choice lasts for the current page only
  and the banner returns on the next page.
- On phones the banner stack sits above the Subscribe band's language
  sheet until the visitor answers it (same as the existing language
  banner).

## Open follow-ups

- Banner strings (`consent.*` in [`en.ts`](../src/i18n/en.ts)) fall back
  to English in all 11 locale dictionaries until translated through the
  usual translation-agent flow.
- India's DPDP Rules (notified November 2025) phase in notice/consent
  obligations by about May 2027; revisit the banner copy and the
  privacy page's language coverage before then. Not legal advice.
