# YouTube Pipeline — Operator Handbook

Day-to-day operations for the @sohamhamso YouTube pipeline — Shorts (format 1)
and full-chapter videos (format 2). For the system map (data-flow, state
machine, secrets inventory) see `pipeline/youtube/ARCHITECTURE.md`; for the
shared CLI flag spec see `pipeline/youtube/CLI-CONVENTIONS.md`; for the full
strategy (including the Chapter Videos governance) see
`docs/YOUTUBE-PIPELINE-PLAN.md`.

Channel: **@sohamhamso** (https://www.youtube.com/@sohamhamso). Single channel,
single Google Cloud project. All uploads land as **unlisted** first; the
operator flips them public after reviewing in YouTube Studio.

---

## Quota model

Since **Dec 4, 2025**, `videos.insert` costs ~100 units (down from 1,600). With
the default **10,000 units/day**, that's roughly **100 uploads/day** — more than
enough for the 149-video Phase 1 scope (≈18 days of backfill even before any
quota raise, which is **optional**). Chapter uploads cost the same flat ~100
units regardless of file size.

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

## OAuth setup (3-scope union)

One-time bootstrap of the refresh token used by Cron B (upload), Cron E
(analytics), and every `videos.update` path — `youtube-revisit.ts`
(flip-public), `youtube-supersede-sweep.ts` (auto-private), and
`youtube-update-seo.ts`.

The token is minted with the **union of exactly three scopes** — one consent
covers every cron:

| Scope | Used by |
|-------|---------|
| `https://www.googleapis.com/auth/youtube.upload` | Cron B `videos.insert` |
| `https://www.googleapis.com/auth/yt-analytics.readonly` | Cron E (`youtube-analytics-sync.ts`) |
| `https://www.googleapis.com/auth/youtube.force-ssl` | `videos.update` — revisit flip-public, supersede-sweep auto-private, update-seo |

> The old "`youtube.upload` only" instruction is **obsolete and actively
> wrong**: a token minted with `youtube.upload` alone 403s Cron E, the
> `youtube-revisit` public flip, and the supersede sweep (`videos.update`
> requires `youtube.force-ssl`). Still NEVER the full `youtube` scope — the
> three-scope union grants no channel / comment / playlist mutation beyond
> the explicit paths above.

1. In Google Cloud Console, create an **OAuth client** (type: Desktop or Web)
   under the project that owns the YouTube Data + Analytics APIs, and allow
   the three scopes above on the consent screen. Note the client id + secret
   (env: `YOUTUBE_OAUTH_CLIENT_ID` / `YOUTUBE_OAUTH_CLIENT_SECRET`).
2. **Step 1 — print the consent URL:**
   ```bash
   bun scripts/youtube-oauth-setup.ts
   ```
3. Open the URL as @sohamhamso, authorize **all three scopes**, copy the code.
4. **Step 2 — exchange the code:**
   ```bash
   bun scripts/youtube-oauth-setup.ts --code=PASTED_CODE
   ```
   Writes the refresh token to `.secrets/yt-refresh.txt` (mode 0600,
   gitignored; the token itself is never printed). The script then prints the
   **GRANTED scopes** (✓ per required scope) and **warns loudly if any of the
   three is missing** — on a short grant, re-run the consent flow and approve
   everything before publishing the secret.
5. Publish the secrets to GitHub Actions:
   ```bash
   gh secret set YOUTUBE_OAUTH_CLIENT_ID
   gh secret set YOUTUBE_OAUTH_CLIENT_SECRET
   gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt
   ```

The R2/S3 secrets (`R2_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_ENDPOINT_URL`) and `GOOGLE_TTS_CREDENTIALS_JSON` are set the same way via
`gh secret set`.

If a `videos.update` caller later hits a 403, the scripts print the named fix
(`refresh token lacks youtube.force-ssl — re-run bun
scripts/youtube-oauth-setup.ts, then gh secret set YT_REFRESH_TOKEN`).

---

## Quarterly OAuth rotation playbook (E5)

Rotate `YT_REFRESH_TOKEN` **every quarter**. Running
`bun scripts/youtube-oauth-setup.ts --refresh` prints this playbook — it does
**not** mint; minting is always the two-step consent flow above, which is
idempotent (`prompt=consent` forces a fresh refresh token on every run).

1. **Mint a new token** — steps 2–4 of OAuth setup (consent URL → `--code=…`)
   → `.secrets/yt-refresh.txt`.
2. **Verify the printed GRANTED scopes include all three** (upload +
   yt-analytics.readonly + force-ssl). Rotating in a short-granted token is
   the regression trap: Cron E, the revisit public flip, and the supersede
   sweep all break 403 on their next fire.
3. **Swap atomically:**
   ```bash
   gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt
   ```
   One secret write between cron fires; the old token stays valid until
   revoked, so in-flight runs are never stranded mid-rotation.
4. **Revoke the old token** at
   https://console.cloud.google.com/apis/credentials (remove the prior grant
   so a leaked old token is dead).
5. **Log the rotation** to `pipeline_runs` with `phase='rotation'` (manual —
   the script does not write the DB), and sanity-check with
   `bun scripts/youtube-status.ts --json`.

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
only the YouTube metadata/visibility changes. `videos.update` needs the
`youtube.force-ssl` scope (see OAuth setup); a scope-short token gets a 403
with the named re-auth fix. The `--reset-retries` recovery mode is documented
under Chapter videos → MAX_RETRY recovery below (it works for shorts too).

---

## Chapter videos (Format 2)

One 16:9 (1920×1080, 30 fps) video per (text, chapter): every verse in
sequence (Devanāgarī + IAST + translation on screen, TTS narration of the
translation), narrated title card, end-screen-safe outro. Chapter rows live in
the same `videos` table with `format='chapter'` and `verse_num=0`. Scripts:
`youtube-render-chapter-samples.ts`, `youtube-backfill-chapters.ts`,
`youtube-render-chapters.ts` (aliases `youtube:render-chapter-samples`,
`youtube:backfill-chapters`, `youtube:render-chapters`).

### Samples (Day-0 + the pacing gate)

Zero-secret Day-0 path — real MP4s with no credentials:

```bash
MOCK_ALL=true bun run youtube:render-chapter-samples
```

Default sample set: spanda-karikas ch2 (full) + siva-sutras ch1 first 8 verses
(short aphoristic sutras — the dead-air stress test). Output:
`samples-chapters/<slug>-chN[-variant].mp4` plus a `.timing.json` sidecar per
render (per-segment start/duration + total) for side-by-side pacing
comparison.

Real-TTS samples need only `GOOGLE_TTS_CREDENTIALS_JSON`:

```bash
bun scripts/youtube-render-chapter-samples.ts --text-slug=spanda-karikas --chapter=2 --full
bun scripts/youtube-render-chapter-samples.ts --variant=floor8 --out=samples-chapters
```

Flags: `--text-slug --chapter --limit --full --out --variant --lang` (plus
`--dry-run --json --help`). Pacing knobs are **config, not code** — edit the
`chapters:` block in `data/youtube-config.yaml` (`min_seg_s`, `seg_lead_in_s`,
`seg_tail_s`, `group_max_verses`, `title_card_s`, `outro_s`,
`encode: cbr8|crf18`) and re-run with a fresh `--variant` label; the timing
sidecars make the gate a side-by-side comparison, not serial re-renders.

### Staged rollout

1. **Preview the backfill plan** (read-only — the one backfill mode that is
   safe to run locally):
   ```bash
   bun scripts/youtube-backfill-chapters.ts --dry-run --json
   ```
2. **Insert + render via the workflow**: Actions → **"YouTube generate
   chapters (Cron A2)"** → Run workflow with `backfill=true` and (optionally)
   `text_slug` / `chapter` to scope the insert, `limit` to cap rendered rows
   (default 2), `dry_run=true` for a CI-side plan first. The scheduled fires
   (03:00 / 15:00 UTC) then drain the pending queue at `--limit=2`.
3. **Confirm**:
   ```bash
   bun scripts/youtube-status.ts --json   # → byFormat.chapter status counts
   ```

### NEVER run the backfill locally

The R2 state-DB push is **last-writer-wins** (`scripts/youtube-state-db.sh`):
a locally pulled DB pushed back clobbers whatever the crons wrote in between.
Every state-mutating chapter run goes through `workflow_dispatch` inside the
`youtube-pipeline` concurrency group. (`--dry-run`, `--json`, and
`youtube-status.ts` reads are fine locally.)

### Window-close checklist (the upload hold gate)

Chapter rows render/QA/land in R2 regardless, but Cron B **holds** them —
logging `N chapter rows held (chapters.uploads_enabled=false — flip in
data/youtube-config.yaml and push to main)` — until the operator flips the
gate. When the 30-day shorts measurement window closes:

1. **Confirm the window-close date** (first-upload dates in the `videos`
   table vs today). Don't flip early — chapter uploads would contaminate the
   shorts kill-switch metrics.
2. **Verify the channel** (next section) if not already done.
3. Flip **`chapters.uploads_enabled: true`** in `data/youtube-config.yaml`.
4. **Commit + push to main** — CI reads the config from the checkout.
5. **Cron B uploads unlisted** on its next fire. Timestamps come from the R2
   `.meta.json` sidecar; a missing sidecar fails the row loudly — a chapter
   video is never uploaded without timestamps.
6. **Review in YouTube Studio**: player, HD source, and the description's
   timestamp block rendering as YouTube chapters.
7. **End screens / cards per video** (subscribe + next chapter) — the outro's
   right and lower thirds are deliberately quiet for these overlays.
8. **Flip public**:
   ```bash
   bun scripts/youtube-revisit.ts --video-id=N --visibility=public
   ```

### Channel verification (>15 min uploads)

siva-sutras ch3 (45 verses) exceeds 15 minutes — **verify @sohamhamso at
https://youtube.com/verify before flipping `uploads_enabled`**. If an upload
hits an unverified channel, the row fails with the named, no-retry error
`channel not verified for >15min uploads — verify at youtube.com/verify, then
retry`; it does **not** burn `retry_count` (retrying cannot succeed until the
channel is verified). After verifying, requeue with `--reset-retries` (below).

### Multi-audio-track test (Studio walkthrough)

Goal (one video): does YouTube multi-language audio make per-language uploads
obsolete? Run it on the **first** uploaded chapter video.

1. **Generate the aligned track** (no DB/R2 mutation):
   ```bash
   bun scripts/youtube-render-chapters.ts --audio-only --video-id=N --lang=hi --out=track.m4a
   ```
   Downloads the row's `.meta.json` sidecar from R2 (or pass
   `--sidecar=path/to/meta.json`), TTSes each verse in the target lang, and
   PCM-pads each one to the existing English segment slots so the track is
   sample-exact against the video. Exits 3 if the row isn't a chapter row or
   the sidecar is missing/unreadable; a chapter whose verses changed since
   render fails with a verse-count mismatch telling you to re-render first.
   **Listen before uploading**: hi narration runs longer than English —
   overflowing verses are truncated to their slot and each truncation is
   logged (`audio-only: narration truncated to segment slot`).
2. **Add the track in YouTube Studio** on that one video (video details →
   audio-track/language surface). Multi-language audio is **Studio-only and
   gated**: the channel needs the Advanced-features tier AND YouTube's
   gradual multi-audio rollout — there is no API path.
3. **If the option is unavailable**, record in `docs/YOUTUBE-PIPELINE-PLAN.md`
   (Chapter Videos → ops checklist): the date, that the channel lacks the
   feature, and that the 12-lang fan-out decision falls back to weighing
   per-language uploads against the kill-switch data.
4. **What the test answers**: per-language *audio* demand only — the hi track
   plays over English on-screen text (it localizes audio + metadata, not
   pixels). Record the outcome either way in the plan doc.

### Verse edit → dispatch-backfill loop

Chapter determinism hashes the whole per-verse manifest
(`chapterContentMd5`): editing ANY verse translation in a chapter — or
swapping its translation row or voice — changes the hash.

- At the next Cron A2 pick of the old row, the engine detects the md5
  mismatch → marks the row `superseded` and **skips** (never the 3 × 90-min
  retry loop). The batch summary prints `superseded awaiting backfill: N`,
  and the Cron D digest's per-format counts carry the superseded rows.
- The replacement row is **not** auto-inserted: dispatch Cron A2 with
  `backfill=true` (scoped with `text_slug`/`chapter`) to insert + render it.

### MAX_RETRY recovery

A chapter row that exhausts its 3 render retries makes the run **exit
non-zero**, so the workflow's failure Issue actually fires. The failure log
names the verse (via `last_error`) and prints both commands:

```bash
# Reproduce locally (keeps + prints the workdir: props JSON, narration, raw mp4):
bun scripts/youtube-render-chapters.ts --video-id=N --keep-workdir

# Recover after fixing the cause (zeroes retry_count + upload_retry_count):
bun scripts/youtube-revisit.ts --video-id=N --reset-retries
```

`--reset-retries` routes by failure phase: upload-phase failures go back to
`approved` (the R2 mp4 is fine — no re-render), everything else back to
`pending` for a fresh render pick-up.

### Pre-M0 checkout guard

The state DB is stamped `PRAGMA user_version = 2` by the M0 migration
(`youtube-db-ensure.ts`). A pre-M0 checkout (no `videos.format` column)
**refuses to open** a post-M0 DB (`update your checkout`) instead of silently
corrupting `verse_num=0` rows. If you hit it, update/rebase your checkout and
re-run.

---

## Daily operations at a glance

- **Cron A** (`youtube-generate.yml`, every 6h) renders pending **short** rows
  → R2, auto-approves on QA pass.
- **Cron A2** (`youtube-generate-chapters.yml`, 03:00/15:00 UTC) renders
  pending **chapter** rows (`--limit=2`, 330-min timeout) → R2 mp4 +
  `.meta.json` sidecar. `workflow_dispatch` inputs: `text_slug`, `chapter`,
  `backfill`, `dry_run`, `limit`.
- **Cron B** (`youtube-upload.yml`, every 4h) uploads approved rows →
  unlisted. Chapter rows are **held** until `chapters.uploads_enabled: true`.
- **Cron D** (`youtube-digest.yml`, daily 12:00 UTC) posts the ops digest Issue
  (labels `youtube`, `ops`) + optional Slack.
- **Cron E** (`youtube-analytics-sync.yml`, daily 05:00 UTC) writes
  `video_analytics` (API-fillable metrics only — see the metric-honesty
  contract in `pipeline/youtube/ARCHITECTURE.md`).
- **Lease sweep** (`youtube-lease-sweep.yml`, hourly) unsticks crashed
  `rendering`/`uploading` rows — TTL **1h for shorts, 4h for chapters**
  (chapter renders routinely run 30–90 min).

Status dashboard any time:

```bash
bun scripts/youtube-status.ts          # human
bun scripts/youtube-status.ts --json   # machine — includes byFormat counts
```

If a scheduled job fails, it opens a GitHub Issue (labels `youtube` +
`youtube-<job>-failure`) per the `turso-backup.yml` precedent — investigate from
the linked run logs.
