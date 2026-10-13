# Security, provenance, and licenses

Explanation and reference for `origin/main` at `4c94bf2`, inspected 2026-10-12. This document describes controls and gaps visible in code. It is not a security certification or a finding that source rights have been cleared.

## Subscriber data and trust boundaries

[POST /api/subscribe](../src/pages/api/subscribe.ts) accepts JSON or form fields `email` and `language`, normalizes email before `HMAC-SHA256` with `SUBSCRIBER_HASH_PEPPER`, creates a 32-character base64url token from 24 random bytes, derives `us`/`eu` from `cf-ipcountry`, and stores a row through [subscriber-db.ts](../src/lib/subscriber-db.ts). English alone is enabled for subscription in [subscribe-langs.ts](../src/lib/subscribe-langs.ts), despite 12 reader locales.

The baseline subscribe handler writes the hash, token, language, region, and subscription time; it does not write the raw email. A keyed email hash remains sensitive pseudonymous data, not anonymous data. A secret pepper resists offline address enumeration after a database leak only while the pepper remains secret. At the edge the guard rejects missing/development-default peppers, but does not enforce the documentation's recommended minimum length; configure a strong random value explicitly.

Duplicate `(email_hash, language)` inserts return friendly success without exposing whether the address already exists. [Confirmation](../src/pages/api/confirm.ts) and [unsubscribe](../src/pages/api/unsubscribe.ts) validate token shape before database work; token redirects have `Cache-Control: no-store, max-age=0`. Confirmation marks a row; unsubscribe deletes it rather than soft-deleting. Malformed/nonexistent unsubscribe tokens get the same landing page as success. A database deletion failure is logged but still redirects to that page, so the redirect alone does not prove deletion. This GET-token flow is not evidence of implementing every email-provider one-click protocol.

The token authorizes both confirmation and deletion via different routes; possession is sensitive. Avoid putting it in analytics, screenshots, support records, or cache keys. The underlying helpers use parameterized queries. No application-level signup rate limiter or origin/CSRF validation is established by this documentation; email shape validation and enumeration-resistant responses have narrower purposes.

## Mailer gap and retention

[send-confirmations.ts](../pipeline/email/send-confirmations.ts) reads a `pending_email_plaintext` column, clears it after successful send or permanent provider failure, records tracking timestamps, and retries transient failures. Its selection is capped at 100 rows from a 24-hour subscription window. The baseline subscription handler does not populate that field, so the source establishes a sender component rather than a complete delivery path. Missing provider configuration is a no-op. Comments proposing stale-row garbage collection are not proof of a retention job.

Database backups may contain PII, secret tokens, and any mailer plaintext present. [The backup workflow](../.github/workflows/turso-backup.yml) retains artifacts for 90 days and optionally uploads to R2; access/retention must include those copies. Public dataset exports explicitly exclude subscriber, embedding, quota, and operational release tables. Deleting a live subscriber row does not automatically remove prior backups. Do not infer a jurisdictional residency guarantee from a `region` field selected using a country header.

Uncommitted D1 cutover code in the original working directory inspected 2026-10-12 adds encrypted subscriber email handling and a plaintext fallback during stabilization. That later design changes the privacy boundary and requires a fresh review; this baseline's hash-only subscribe behavior must not be used to describe those files as deployed or safe by inheritance.

## Search and output safety

[Search-miss logging](../src/lib/search-miss.ts) records query text sanitized of controls, collapsed whitespace and capped at 80 characters, plus language/type and a UTC day bucket. It does not record IP, user agent, session, or subscriber links. Query strings can still contain sensitive information typed by users. The logger is best-effort and must not fail the response. The corpus adapter can execute these writes despite being described as read-only in its header; credential scope should match actual use.

[Safe JSON helpers](../src/lib/safe-json.ts) and [SEO/XML tests](../tests/unit/seo/xml-escape.adversarial.test.ts) address embedding content in script/structured metadata. Source-provided attribution HTML and generated text should be reviewed at the ingestion boundary before publication. AI-generated strings are corpus content, not authorization to execute instructions, commands, or publishing actions.

## Credentials and OAuth

[.env.example](../.env.example) distinguishes reader runtime credentials from operator/CI credentials. Turso account-level CLI tokens used for provisioning/backup differ from per-database runtime tokens. Keep CORPUS and PII secret scopes separate even when sharing infrastructure. Configuration permits the two URLs to point at the same database; source separation does not prove physical isolation or read-only authorization.

Media credentials pass through [pipeline/youtube/secrets.ts](../pipeline/youtube/secrets.ts); `MOCK_ALL=true` provides a credentials-free test path. [OAuth setup](../scripts/youtube-oauth-setup.ts) requests the union of `youtube.upload`, `yt-analytics.readonly`, and `youtube.force-ssl` for uploading, analytics, and metadata updates. Older “upload only” comments are stale. The setup writes the refresh token to `.secrets/yt-refresh.txt` and prints its path rather than its value. A refresh token can authorize channel mutations: protect the local file, GitHub secrets and workflow permissions, and verify granted scopes before live runs.

[Media redaction tests](../tests/unit/youtube/pipeline-run-redaction.test.ts) exercise redaction of recorded errors. That is not a guarantee that every provider error/log is free of sensitive information; for example mailer failure paths include a truncated provider body. Review artifacts before sharing them. R2 credentials cover media, state snapshots, or backup objects according to configuration; separate buckets and scoped access are operational controls to verify.

## Translation provenance and disclosure

The [status contract](../STATUS-CONTRACT.md) distinguishes `draft`, `published`, and `reviewed`, and tracks `ai_assisted` separately. A published AI row is not a human-reviewed row. Model, model version, prompt version, judge score, source/license, reviewer, and review time support traceability in [schema.sql](../db/schema.sql). Read [AI systems and evaluation](AI-SYSTEMS-AND-EVALUATION.md) for actual grounding inputs and the limits of LLM-as-judge scores.

[AI badge state](../src/lib/ai-badge-state.ts), [draft visibility tests](../tests/unit/draft-visibility.test.ts), and [dataset publishing](../pipeline/dataset/publish.ts) support disclosure/filtering. Published status or a score field alone does not prove a particular judge was executed; manually imported content and incomplete provenance must be investigated. Existing agent-authored morphology should not be described as deterministic Vidyut output merely because a morphology runner exists.

Contributors should preserve source URLs/revisions, encoding quirks and edition notes; reviewers assess Sanskrit fidelity and language quality rather than merely removing the AI badge. Retain prompt/model provenance when correcting a translation, and credit human review only when the recorded reviewer action supports it.

## License layers and release responsibility

[LICENSE](../LICENSE) establishes MIT for source code and CC BY-SA 4.0 for corpus/documentation outputs, subject to applicable upstream restrictions. [ATTRIBUTION.md](../ATTRIBUTION.md) contains the per-source/per-text record. A blanket project license does not grant rights to upstream transcriptions, audio performances, photography, video clips, commissioned visuals, model outputs, or fonts.

| Material | Evidence to preserve before redistribution |
| --- | --- |
| Sanskrit transcription | Specific source file, revision/access date, attribution, its actual terms |
| Translation/gloss | Human/AI origin, model/prompt/review metadata, declared license, underlying source terms |
| Muktabodha-derived text | `pending_miri` flag and permission correspondence; reader access is not proof of export permission |
| GRETIL transcription | Per-file header; some entries are BY-NC-SA, not generic BY |
| Source audio | Recording/performance rights, owner permission, origin and permitted uses |
| Fonts/visuals | Per-asset license and attribution; verify both bundling and video use |
| Dataset release | Eligible row filter, source hold list, checksums, release/license inventory and deposit record |

The publisher excludes `pending_miri` texts and draft translations. Passing those machine gates means export eligibility under the implemented policy, not a comprehensive rights clearance. A public-domain underlying Sanskrit work may have a modern transcription with separate conditions. Repository statements about source rights should be treated as recorded attribution evidence until checked against source terms; this document does not issue a legal conclusion.

Media attribution must cover recording and visual inputs independently of scripture attribution. A public channel video can demonstrate an output without proving which pipeline generated it. Avoid implying text-to-video model integration or AI-created imagery where only composition/source audio is evidenced. Dataset DOI examples containing `PLACEHOLDER` are templates; confirmed publication requires a real deposit identifier and resolvable DOI record.

## Verification entry points

[Subscribe edge tests](../tests/unit/subscribe-edge-compat.test.ts), [confirm endpoint tests](../tests/unit/confirm-endpoint.test.ts), [draft visibility tests](../tests/unit/draft-visibility.test.ts), [OAuth setup](../scripts/youtube-oauth-setup.ts), and [Turso operating runbook](TURSO.md) let contributors inspect these boundaries. Tests with injected databases/providers establish local behavior; live secret scopes, backup access, delivered email and deployed worker configuration need separate evidence.
