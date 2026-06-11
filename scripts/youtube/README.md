# YouTube Pipeline — Operator Handbook

Day-to-day operations for the @sohamhamso YouTube Shorts pipeline. For the
system map (data-flow, state machine, secrets inventory) see
`pipeline/youtube/ARCHITECTURE.md`; for the shared CLI flag spec see
`pipeline/youtube/CLI-CONVENTIONS.md`; for the full strategy see
`docs/YOUTUBE-PIPELINE-PLAN.md`.

Channel: **@sohamhamso** (https://www.youtube.com/@sohamhamso). Single channel,
single Google Cloud project. All uploads land as **unlisted** first; the
operator flips them public after reviewing in YouTube Studio.

---

## Quota model

Since **Dec 4, 2025**, `videos.insert` costs ~100 units (down from 1,600). With
the default **10,000 units/day**, that's roughly **100 uploads/day** — more than
enough for the 149-video Phase 1 scope (≈18 days of backfill even before any
quota raise, which is **optional**).

- Cron B pre-checks `youtube_quota` for the current UTC date and **skips** if
  `units_spent > 8000` (2k headroom).
- A 403 `quotaExceeded` is handled gracefully: set `exhausted=1`, exit 0. Quota
  resets at midnight **Pacific**.
- Analytics (Cron E) uses a **separate quota bucket** from uploads, so the daily
  sync never competes with Cron B.

Stagger, don't bulk-dump: spreading uploads across Cron B's 4h cadence (~6 per
cycle) is also the strongest mitigation against the July 2025 YouTube
mass-AI-content spam policy.

---

## OAuth setup

One-time bootstrap of the refresh token used by Cron B (upload) and Cron E
(analytics).

1. In Google Cloud Console, create an **OAuth client** (type: Desktop or Web)
   under the project that owns the YouTube Data API. Note the client id +
   secret.
2. Set the consent screen scope to **`https://www.googleapis.com/auth/youtube.upload`
   only** — NOT the full `youtube` scope (which would grant channel / comment /
   playlist mutation and widen the blast radius).
3. Run the bootstrap:
   ```bash
   bun scripts/youtube-oauth-setup.ts
   ```
   This opens the consent flow for @sohamhamso and writes the refresh token to
   `.secrets/yt-refresh.txt` (gitignored).
4. Publish the secrets to GitHub Actions:
   ```bash
   gh secret set YOUTUBE_OAUTH_CLIENT_ID
   gh secret set YOUTUBE_OAUTH_CLIENT_SECRET
   gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt
   ```

The R2/S3 secrets (`R2_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_ENDPOINT_URL`) and `GOOGLE_TTS_CREDENTIALS_JSON` are set the same way via
`gh secret set`.

---

## Quarterly OAuth rotation playbook (E5)

Rotate `YT_REFRESH_TOKEN` **every quarter** (4 steps). The `youtube.upload`-only
scope keeps the blast radius small even between rotations.

1. **Mint a new token:**
   ```bash
   bun scripts/youtube-oauth-setup.ts --refresh
   ```
   Issues a fresh refresh token to `.secrets/yt-refresh.txt`.
2. **Publish it:**
   ```bash
   gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt
   ```
3. **Revoke the old token** at
   https://console.cloud.google.com/apis/credentials (remove the prior grant so
   a leaked old token is dead).
4. **Log the rotation** to `pipeline_runs` with `phase='rotation'` (the
   `--refresh` flow does this automatically; verify with
   `bun scripts/youtube-status.ts --json`).

Anomaly backstop: the Cron D digest alarms if `uploads_per_hour > 20`, catching
a compromised key within ~4h rather than waiting for the 24h quota boundary.

---

## Channel handover (second admin / bus-factor)

A single-operator channel is a bus-factor risk and a single point of strike
blast-radius. Add a **second human admin** on the @sohamhamso **Brand Account**:

1. Go to https://myaccount.google.com/brandaccounts → @sohamhamso → **Manage
   permissions**.
2. Invite the second person's Google account as a **Manager** (or **Owner** for
   full handover).
3. They accept the invite; verify they can reach YouTube Studio for the channel.
4. Record who holds access in your ops notes. On primary-operator departure,
   promote the second admin to Owner and rotate `YT_REFRESH_TOKEN` (above).

Note: Brand Account roles are independent of the OAuth refresh token — rotating
one does not affect the other. Keep both current.

---

## Flipping a video public (`youtube-revisit.ts`)

Uploads land **unlisted**. After reviewing a video in YouTube Studio (player +
analytics preview + native moderation are the real review surface — there is no
GitHub-issue approval queue, that was dropped per E8), flip it public **without
re-rendering** (a `videos.update`, ~50 quota units):

```bash
# Make a reviewed video public:
bun scripts/youtube-revisit.ts --video-id=42 --visibility=public

# Other metadata-only changes (no re-render) are supported the same way, e.g.:
bun scripts/youtube-revisit.ts --video-id=42 --title="…"
```

`--video-id` is the row id in the `videos` table (not the YouTube id). Use
`--json` to script bulk flips. This never re-renders or re-uploads the asset —
only the YouTube metadata/visibility changes.

---

## Daily operations at a glance

- **Cron A** (`youtube-generate.yml`, every 6h) renders pending rows → R2,
  auto-approves on QA pass.
- **Cron B** (`youtube-upload.yml`, every 4h) uploads approved rows → unlisted.
- **Cron D** (`youtube-digest.yml`, daily 12:00 UTC) posts the ops digest Issue
  (labels `youtube`, `ops`) + optional Slack.
- **Cron E** (`youtube-analytics-sync.yml`, daily 05:00 UTC) writes
  `video_analytics`.
- **Lease sweep** (`youtube-lease-sweep.yml`, hourly) unsticks crashed
  `rendering`/`uploading` rows after 1h.

Status dashboard any time:

```bash
bun scripts/youtube-status.ts          # human
bun scripts/youtube-status.ts --json   # machine
```

If a scheduled job fails, it opens a GitHub Issue (labels `youtube` +
`youtube-<job>-failure`) per the `turso-backup.yml` precedent — investigate from
the linked run logs.
