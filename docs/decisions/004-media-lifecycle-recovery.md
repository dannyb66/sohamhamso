# Decision 004: persisted media lifecycle and recovery

**Status:** implemented pattern at `origin/main` (`4c94bf2`), reviewed 2026-10-12. **Rationale:** reconstructed from source/tests and the [historical YouTube plan](../YOUTUBE-PIPELINE-PLAN.md); this record was not written when the original decisions were made.

## Problem and decision

Speech synthesis, browser rendering, object storage, and external uploads fail independently. Rendering an entire chapter again after a quota error wastes work, while an interrupted runner can leave a record permanently in progress. Corpus edits also require a way to replace outputs without losing their publishing history.

Persist each output version in a writable SQLite `videos` table. Separate render/QA/storage from YouTube insertion. Use format-specific content hashes and template versions to determine whether an output can be reused; use phase-specific errors and leases to recover work. Share one R2-synced state file across serialized Actions workflows. Public visibility requires a separate operator action.

```text
corpus + config -> backfill -> pending -> rendering -> approved -> uploading -> uploaded
                                ^             |                      |
                                |         failed(render)         failed(upload)
                                |             |                      |
                                +-------------+          reset -> approved

changed chapter manifest -> superseded -> explicit backfill -> new pending version
stale rendering/uploading lease -> failed (original phase retained)
```

The schema also admits `rendered` and `rejected`; it validates status membership, not all transition edges. The [platform reference](../AI-VIDEO-AND-YOUTUBE-PLATFORM.md) describes exact flows and current rollout holds.

## Implementation evidence

| Mechanism | Source and verification |
| --- | --- |
| Lifecycle DB and content/template reuse | [`videos-db.ts`](../../src/lib/videos-db.ts); [videos-table tests](../../tests/unit/youtube/videos-table.test.ts) |
| Separate mutable state file | [`youtube-state-db.sh`](../../scripts/youtube-state-db.sh); workflow `YOUTUBE_DB_PATH=db/youtube-state.db` |
| Chapter manifest hash includes per-verse content, row, and voice | [`determinism.ts`](../../pipeline/youtube/determinism.ts); [chapter-determinism tests](../../tests/unit/youtube/chapter-determinism.test.ts) |
| Upload-phase failure does not trigger expensive chapter render | [queue tests](../../tests/unit/youtube/render-queue-chapters.test.ts); [`youtube-revisit.ts`](../../scripts/youtube-revisit.ts) |
| Format-aware stale leases | [`youtube-lease-sweep.ts`](../../scripts/youtube-lease-sweep.ts); [lease tests](../../tests/unit/youtube/lease-sweep.test.ts) |
| Approval requires MP4 and timestamp sidecar | [`chapter-render-engine.ts`](../../pipeline/youtube/chapter-render-engine.ts); integration chapter tests in [`tests/integration/youtube`](../../tests/integration/youtube) |
| Download integrity before external insert | [`youtube-upload.ts`](../../scripts/youtube-upload.ts) compares downloaded bytes with stored SHA-256 |
| Old version visibility policy | [`youtube-supersede-sweep.ts`](../../scripts/youtube-supersede-sweep.ts); [supersession tests](../../tests/unit/youtube/supersede-policy.test.ts) |

## Recovery contract

Rendering leases expire after one hour for Shorts and four hours for chapters; absent/invalid timestamps also count as stale. The sweep preserves whether the failed work was render or upload. Render retries stop at three attempts, and chapter TTS has two attempts per title/verse. Explicit retry reset sends upload failures to `approved`, and render failures to `pending`. The uploader selects approved rows only; generic failed uploads and stale upload leases need an explicit reset. A changed live chapter manifest supersedes the old row rather than repeatedly retrying stale input; the replacement needs a subsequent backfill.

A chapter sidecar failure leaves the row unapproved. MP4 and JSON puts are sequential; an orphan MP4 can remain. Retry writes both again. An uploaded video stores the provider ID, enabling metadata/visibility changes without rerendering. A superseded public video can be made private after 30 days, but the sweep does not check that the replacement is public. No dedicated supersede-sweep schedule is configured at this baseline.

## Tradeoffs and known limits

A single SQLite file and Actions concurrency group are simple to inspect and recover at this project's scale. They serialize all participating jobs, including long chapter renders, and constrain throughput. R2 state transfer is last-writer-wins; a local push or another writer outside the concurrency group can lose updates. The shell pull treats every failed download as first-run absence, including network/auth errors, so recovery requires inspecting failures before proceeding with fresh state. This is not a distributed transaction or a production database lock.

Persisted status and leases recover runner crashes but are not exactly-once delivery. There is no lease heartbeat or external upload idempotency key. The chapter uploader retries one network failure with a fresh multipart stream; if YouTube accepted the first request but its response was lost, retry can duplicate the video. Inspect Studio before replaying ambiguous uploads.

Input hashes identify versions; they do not authenticate content. Short hashes cover translation text but omit voice; R2 object keys omit template version, so identical-content template rerenders can overwrite an existing path. The Short ETag gate compares local MD5 to itself and cannot prove remote integrity; the real SHA-256 download check is the useful boundary before upload. YouTube's transcoded output is not checksum-verified.

Keeping old lifecycle rows preserves provenance and publishing history, while a grace period delays hiding old videos. It also retains artifacts and requires an explicit visibility-policy run. Baseline chapter uploads are held in config and upload scheduling is paused; merged recovery code does not establish deployed publishing activity.

## Alternatives and triggers to revisit

The historical plan proposed a separate input-hash keystone and issue-based review queue; the reconciled implementation uses content/template fields and Studio review instead. A durable managed queue, transactional database, renewed leases, and resumable/idempotent uploads are potential future approaches rather than implemented capabilities. Revisit this design when independent workers or higher throughput are required, concurrency wait time becomes operationally limiting, or duplicate/partial publishing incidents warrant a stronger external reconciliation contract.
