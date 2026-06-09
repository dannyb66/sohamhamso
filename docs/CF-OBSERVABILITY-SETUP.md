# Cloudflare Observability — Post-Launch Setup

Operator runbook for enabling Cloudflare Web Analytics and a 72h Logpush
sink to R2 immediately after launch.

This complements the SEO/launch plan recorded in
`.gstack/launch/deployment-plan-2026-06-01.md` (sections "Analytics" and
"Uptime / monitoring"). Per that plan: CF Web Analytics is the only
analytics surface (free, cookieless, no PII), and Logpush is a
short-lived diagnostic — enabled for the first 72h to catch crawler
issues, 4xx/5xx hot spots, OG endpoint health, and cache-miss patterns,
then disabled.

## Status (as of 2026-06-08 evening launch)

- Site live: `https://sohamhamso.org`
- Hosting: Cloudflare Pages, project `sohamhamso`
- Logpush window: 2026-06-08 evening → **2026-06-11 evening** (T+72h)
- R2 sink: bucket `sohamhamso-backups`, prefix `logpush/72h-post-launch/`

## Part 1 — Cloudflare Web Analytics (manual, one-click)

CF Web Analytics for a CF-proxied zone is the **zone-level** product:
Cloudflare observes traffic server-side at the edge (it already proxies
every request), so **no client-side beacon script is required**. This
preserves the privacy promise on `/about/privacy` (no client analytics,
no cookies, no fingerprinting).

> There is a separate **"Web Analytics" beacon product** that asks you
> to drop a `<script>` tag for off-Cloudflare sites or for richer
> client-side metrics (Web Vitals, page navigation). We intentionally
> are NOT enabling that variant — it would break the "no client
> analytics scripts" promise. If you later want Web Vitals, that is a
> deliberate decision and a separate doc update on the privacy page.

### Click path

1. https://dash.cloudflare.com → select the **`sohamhamso.org`** zone
   (not the Pages project — this is the DNS zone view).
2. Sidebar → **Analytics & Logs** → **Web Analytics**.
3. Click **Enable Web Analytics** for the zone.
4. Verify: the Web Analytics page now shows pageviews and unique
   visitors aggregated from server-side request data. No further
   action needed.

### Confirmation checklist

- [ ] `sohamhamso.org` zone shows "Web Analytics: Enabled".
- [ ] No `<script src="...static.cloudflareinsights.com/beacon...">`
      tag was added to `src/layouts/BaseLayout.astro`. (We are
      explicitly NOT inserting the JS beacon — confirm by `git diff`
      stays empty for `BaseLayout.astro`.)
- [ ] The privacy page (`/about/privacy`) now references CF Web
      Analytics; see Part 4.

### GDPR / IP anonymization

CF Web Analytics is GDPR-clean by design:

- No cookies, no localStorage, no fingerprinting.
- No client-side script delivered to visitors (zone-server variant).
- Client IPs are visible to Cloudflare at the edge for request routing
  and DDoS protection — same as every CF-proxied site on the public
  internet — and are not stored against any persistent visitor
  identifier by Cloudflare in the Web Analytics aggregate.
- No data is sold or forwarded to third parties.

This matches Cloudflare's published GDPR / privacy stance. The privacy
page on the site (`/about/privacy`) restates this in plain prose.

## Part 2 — Logpush 72h sink → R2

Programmable. Three scripts in `scripts/`:

| Script | Purpose | When |
|---|---|---|
| `seo-cf-logpush-setup.ts` | Create the Logpush job | Once, right now (T+24h) |
| `seo-cf-logpush-tail.ts` | Download latest dump, summarize 4xx/5xx/OG | Ad-hoc during the 72h window |
| `seo-cf-logpush-disable.ts` | Disable the job | Once, at T+72h |

### Required credentials

These are NOT committed. Set in your shell or `.env`:

```bash
# Cloudflare API token with Logpush:Edit on the sohamhamso.org zone.
# Create at: https://dash.cloudflare.com/profile/api-tokens
#   Permissions: Zone → Logs → Edit (on sohamhamso.org)
#   Token type: Custom token, not Global API Key.
export CF_API_TOKEN=...

# Cloudflare account ID (sidebar of dash.cloudflare.com, right column).
export CF_ACCOUNT_ID=...

# Zone ID for sohamhamso.org (Overview tab of the zone, right column).
export CF_ZONE_ID=...

# R2 S3-compatible credentials for the sohamhamso-backups bucket.
# Logpush authenticates to R2 via S3 API, so it needs an R2 access key
# pair — NOT the CF API token. Create at:
#   dash.cloudflare.com → R2 → Manage R2 API Tokens → Create API Token
#   Permissions: Object Read & Write on sohamhamso-backups.
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
```

All scripts support `--dry-run` which prints the exact HTTP method, URL,
headers (token redacted), and JSON body that would be sent — useful for
sanity-checking before running for real.

### Setup (T+24h, run now)

```bash
bun run seo:cf-logpush:setup
```

This POSTs to
`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/logpush/jobs`
with:

- `dataset`: `http_requests`
- `destination_conf`: `r2://sohamhamso-backups/logpush/72h-post-launch/{DATE}?...`
  (R2 inserts `{DATE}` as a daily subfolder, then a generated filename
  with hour/minute/unique-id suffix on each batch)
- `filter`: matches `ClientRequestHost = "sohamhamso.org"` so we don't
  capture traffic from other zones if the token is broader
- `output_options.field_names`: `EdgeStartTimestamp`, `ClientIP`,
  `EdgeResponseStatus`, `EdgeResponseBytes`, `ClientRequestHost`,
  `ClientRequestPath`, `ClientRequestUserAgent`,
  `ClientRequestReferer`, `CacheCacheStatus`
- `output_options.timestamp_format`: `rfc3339`
- `output_options.output_type`: `ndjson`
- `enabled`: `true`

On success the script prints the returned `job_id` (an integer). **Save
that** — you need it for `disable` at T+72h. The setup script also
appends it to `.gstack/launch/logpush-job-id.txt` (gitignored).

### Verify via CF dashboard

After setup runs:

1. https://dash.cloudflare.com → `sohamhamso.org` zone →
   **Analytics & Logs** → **Logs** → **Logpush**.
2. The new job should appear, **Status: Enabled**, **Dataset:
   HTTP requests**, **Destination: r2://sohamhamso-backups/...**.
3. Within ~5 min, the first batch appears in R2 under
   `logpush/72h-post-launch/YYYY-MM-DD/`. Verify with:
   ```bash
   wrangler r2 object list sohamhamso-backups --prefix=logpush/72h-post-launch/
   ```

### Tail (ad-hoc, during the 72h window)

```bash
bun run seo:cf-logpush:tail              # latest hour, all summaries
bun run seo:cf-logpush:tail -- --hour=3  # 3 hours back
```

Downloads the most recent batch file(s) from R2 via `wrangler r2
object get`, decompresses (Logpush delivers gzipped NDJSON), and prints
sorted summary tables for:

- **4xx by status + path** — look for 404s on canonical URLs (broken
  internal links) or 410s on intentionally-removed routes.
- **5xx by status + path** — must be zero; any 5xx is a SLO violation.
- **0-byte 200 responses** — silent failures. Empty `EdgeResponseBytes`
  with `200` means the origin/Worker returned an empty body. Investigate.
- **OG endpoint health** (`/og/*` paths) — confirms the dynamic PNG
  endpoints under `functions/og/` are returning >0 bytes and 200s.
- **Sitemap cache MISS** — `CacheCacheStatus = MISS` on
  `/sitemap-index.xml` or child sitemap routes indicates cache
  invalidation problems.

### Disable (T+72h, 2026-06-11 evening)

```bash
bun run seo:cf-logpush:disable
```

This PUTs to
`https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/logpush/jobs/${JOB_ID}`
with `{"enabled": false}`. The job_id is read from
`.gstack/launch/logpush-job-id.txt` (auto-saved by setup), or you can
pass `--job-id=12345` explicitly.

**This is critical.** If you skip this step, Logpush keeps writing to
R2 forever, accumulating storage costs and PII (client IPs) beyond what
the launch-window plan authorized.

After disable, confirm via dashboard that the job shows **Status:
Disabled**. Then plan a manual R2 purge of the
`logpush/72h-post-launch/` prefix when you're done analyzing.

## Part 3 — Bookmark dashboards

Pin these in your browser for the 72h window and the first month
post-launch:

| Dashboard | URL pattern | What to look for |
|---|---|---|
| Zone analytics | `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/sohamhamso.org/analytics/traffic` | Request volume, % cached, top countries |
| Pages deployments | `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/pages/view/sohamhamso` | Build success, latest commit live |
| Pages 4xx/5xx by route | `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/sohamhamso.org/analytics/web` → filter on status | Spikes on a specific path = broken canonical/redirect |
| CF Logs | `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/sohamhamso.org/analytics/logs/logpush` | Logpush job health, last delivery timestamp |
| R2 bucket | `https://dash.cloudflare.com/${CF_ACCOUNT_ID}/r2/default/buckets/sohamhamso-backups` | Logpush dumps under `logpush/72h-post-launch/` |
| GSC Coverage | `https://search.google.com/search-console?resource_id=sc-domain%3Asohamhamso.org` → Coverage | Indexing progress |

## Part 4 — Privacy disclosure update

The `/about/privacy` page is updated in the same PR as this doc. The
change is small and matches what's actually shipped:

- Adds a paragraph noting CF Web Analytics is enabled, observes
  server-side at the edge, no client-side script, no cookies.
- Tightens the "No analytics scripts" bullet to "No **client-side**
  analytics scripts" — accurate, since CF observes server-side.

Last updated date on `privacy.astro` advanced to `2026-06-08`.

## Part 5 — Audit trail

For SEO/launch audit purposes, this doc captures:

- **What is automated by scripts**: Logpush job creation, the
  tail-and-summarize loop, and disable.
- **What requires a manual click**: enabling CF Web Analytics on the
  zone (CF dashboard does not support API-only enable for the
  zone-level Web Analytics surface).
- **72h timer**: 2026-06-08 evening → 2026-06-11 evening. Set a
  calendar reminder; `seo:cf-logpush:disable` is a one-shot.
- **No client-side script** was added to the Astro layout; `BaseLayout`
  diff for this PR is empty on that front.
