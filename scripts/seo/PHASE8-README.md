# SEO Phase 8 — Post-launch measurement

Automated checks fired at T+24h, T+7d, T+30d after the `LOCALE_URLS_LIVE=true`
flip on **2026-06-08 evening UTC**.

Source of truth: `plan-to-do-all-fluffy-hopcroft.md` Phase 8 (lines 354-366).

| Tier | Target date | What runs |
|---|---|---|
| T+24h | 2026-06-09 | OG fallback rate (50 URLs) · CF 4xx/5xx · GSC URL inspect (3/locale) |
| T+7d | 2026-06-15 | GSC sitemap coverage ≥60% · GSC Indic impressions > 0 |
| T+30d | 2026-07-08 | Lighthouse LCP < 2.5s · GSC zero "Submitted URL marked noindex" |

## Scripts

```
scripts/seo-phase8-tplus24h.ts
scripts/seo-phase8-tplus7d.ts
scripts/seo-phase8-tplus30d.ts
```

Each script:

- Exits **0** if all automated thresholds pass.
- Exits **non-zero** if any automated threshold breaches.
- Prints a **manual checklist** when API credentials are missing, then exits 0
  (so the cron run doesn't churn). The workflow surfaces a `::warning::`
  annotation in that case — humans get a GH Actions notification.

Run locally:

```bash
bun scripts/seo-phase8-tplus24h.ts
bun scripts/seo-phase8-tplus7d.ts
bun scripts/seo-phase8-tplus30d.ts
```

## Schedule

Single daily cron at **20:00 UTC** in `.github/workflows/seo-phase8.yml`.

The workflow computes `delta_days = today - LAUNCH_DATE` and routes:

- `delta_days ∈ [1, 2]` → T+24h
- `delta_days ∈ [7, 8]` → T+7d
- `delta_days ∈ [30, 31]` → T+30d
- Any other → no-op (workflow exits cleanly)

The 1-day grace window covers the case where the scheduled run is delayed or
the launch date is mis-dated by a few hours.

Force a tier with `workflow_dispatch` → `tier: tplus24h | tplus7d | tplus30d`.

## What is automated vs manual

| Check | Automated? | Notes |
|---|---|---|
| OG fallback rate (T+24h) | **Yes** | HEAD probes the live `og:image` URLs, parses `X-OG-Fallback` |
| CF 4xx/5xx by locale (T+24h) | **Yes, with creds** | CF GraphQL `httpRequestsAdaptiveGroups`. Requires `CF_ANALYTICS_TOKEN` + `CF_ZONE_ID` |
| GSC URL inspection (T+24h) | **API or manual** | If `GSC_ACCESS_TOKEN` set, calls `urlInspection.index.inspect`. Otherwise prints the 9 URLs (3 × 3 locales) to inspect by hand |
| GSC Coverage ≥60% (T+7d) | **API or manual** | If token set, calls `sites.sitemaps.list` and computes indexed/submitted. Otherwise prints the per-sitemap dashboard URL |
| GSC Indic impressions (T+7d) | **API or manual** | If token set, calls `searchAnalytics.query` grouped by Page, buckets by locale prefix |
| Lighthouse LCP (T+30d) | **Yes** | `npx -y lighthouse` on the 3 target URLs, headless Chrome on the GHA runner |
| CrUX field LCP (T+30d) | **Best-effort** | Fresh sites typically return `404 NOT_FOUND` for ~6 months — that's expected, not a failure. Does not affect exit code |
| GSC noindex errors (T+30d) | **API or manual** | The API exposes sitemap-level error counts but not per-category breakdown ("Submitted URL marked noindex" specifically). For that we point to the Coverage dashboard |

## Required secrets

Set as GitHub Actions repo secrets (Settings → Secrets → Actions).

| Secret | What it's for | How to get it |
|---|---|---|
| `CF_ANALYTICS_TOKEN` | CF GraphQL Analytics API | dash.cloudflare.com → My Profile → API Tokens → Create. Scopes: Account.Analytics:Read + Zone.Analytics:Read |
| `CF_ZONE_ID` | CF zone for sohamhamso.org | Visible on the Cloudflare zone overview page (right sidebar). Public ID, but kept as a secret to avoid leaking infra details |
| `GSC_ACCESS_TOKEN` | GSC API OAuth access token | See "GSC OAuth setup" below. Tokens expire in 1h — for production use a refresh-token flow |
| `GSC_SITE_URL` | GSC property identifier | Either `sc-domain:sohamhamso.org` (domain property) or `https://sohamhamso.org/` (URL-prefix property). Use whichever was verified during launch |
| `CRUX_API_KEY` | (optional) CrUX API rate-limit relief | console.cloud.google.com → APIs & Services → Credentials. Only needed if the anonymous free tier rate-limits us |

## GSC OAuth setup

The GSC API requires OAuth 2.0. Service accounts don't work — Google requires
a user-owned property to be granted access by a human owner of the property.

**One-time setup (~10 min):**

1. **Create OAuth client**
   - https://console.cloud.google.com → APIs & Services → Credentials
   - Create OAuth client ID, type "Desktop app"
   - Save the `client_id` and `client_secret`

2. **Enable the API**
   - APIs & Services → Library → "Search Console API" → Enable

3. **Generate a refresh token**
   - Use the OAuth playground: https://developers.google.com/oauthplayground
   - Top-right gear → "Use your own OAuth credentials" → paste client_id/secret
   - Scope: `https://www.googleapis.com/auth/webmasters.readonly`
   - Authorize → Exchange authorization code for tokens
   - Copy the **refresh token** (never expires unless revoked)

4. **Mint short-lived access tokens for the cron**

   The cron job needs an `access_token` per run. Two options:

   a. **Refresh inline in the workflow** (recommended). Add a pre-step that
      POSTs to `https://oauth2.googleapis.com/token` with the refresh token
      and exports `GSC_ACCESS_TOKEN` to subsequent steps. Add secrets
      `GSC_OAUTH_CLIENT_ID`, `GSC_OAUTH_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`.

   b. **Manually run before each scheduled tier** (lazy option). Run
      `gcloud auth application-default print-access-token` locally, paste into
      the repo secret `GSC_ACCESS_TOKEN`, kick off the workflow with
      `workflow_dispatch`. Token expires in 1h — only viable for ad-hoc runs.

   The scripts in this folder accept the access token directly and don't care
   how it was minted.

**TODO**: implement option (a) refresh step in `seo-phase8.yml` once OAuth
credentials are provisioned. Until then, the scripts gracefully fall back to
manual-check mode.

## Failure response

Any non-zero exit code → GitHub Actions marks the run as failed → repo
notifications fire. Per the SEO plan:

> Failure of any threshold → diagnostic ticket, not silent.

The rollback runbook lives in the plan (lines 368-382). Notably: flipping
`LOCALE_URLS_LIVE` back is **not** a rollback — it only blocks future crawls.
Real rollback requires the per-locale steps described there.
