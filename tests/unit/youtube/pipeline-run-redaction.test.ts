/**
 * pipeline-run-redaction.test.ts (E6)
 *
 * `scrubError` is the single redaction chokepoint for anything persisted to
 * `videos.last_error` / `pipeline_runs.error_msg`. It MUST strip:
 *   - Google service-account paths (*.iam.gserviceaccount.com)
 *   - AWS/R2 access key ids (AKIA…)
 *   - Google OAuth tokens (ya29.… and 1//…)
 *   - 30+-char runs of Indic-script translation text
 *
 * After scrubbing, none of the sensitive substrings may remain and the
 * `[redacted]` marker must appear.
 */
import { describe, expect, it } from 'vitest';
import { scrubError } from '../../../pipeline/youtube/log';

const SERVICE_ACCOUNT = 'foo-bar@my-proj.iam.gserviceaccount.com';
const AKIA_KEY = 'AKIAIOSFODNN7EXAMPLE';
const YA29_TOKEN = `ya29.${'A'.repeat(40)}-_abc`;
const REFRESH_TOKEN = `1//${'0'.repeat(40)}xyz`;
// 35-char Devanagari run (translation-text leak).
const DEVANAGARI_RUN = 'चैतन्यमात्माज्ञानंबन्धःयोनिवर्गःकलाशरीरम'; // > 30 Devanagari chars

describe('scrubError (E6 redaction)', () => {
  it('redacts a service-account identity', () => {
    const out = scrubError(`auth failed for ${SERVICE_ACCOUNT} retrying`);
    expect(out).not.toContain(SERVICE_ACCOUNT);
    expect(out).not.toContain('iam.gserviceaccount.com');
    expect(out).toContain('[redacted]');
  });

  it('redacts an AKIA access key id', () => {
    const out = scrubError(`R2 rejected key ${AKIA_KEY}`);
    expect(out).not.toContain(AKIA_KEY);
    expect(out).toContain('[redacted]');
  });

  it('redacts a ya29. OAuth access token', () => {
    const out = scrubError(`bad token ${YA29_TOKEN}`);
    expect(out).not.toContain(YA29_TOKEN);
    expect(out).toContain('[redacted]');
  });

  it('redacts a 1// refresh token', () => {
    const out = scrubError(`refresh ${REFRESH_TOKEN} expired`);
    expect(out).not.toContain(REFRESH_TOKEN);
    expect(out).toContain('[redacted]');
  });

  it('redacts a 30+ char Devanagari translation run', () => {
    const out = scrubError(`render dump: ${DEVANAGARI_RUN}`);
    expect(out).not.toContain(DEVANAGARI_RUN);
    expect(out).toContain('[redacted]');
  });

  it('redacts every sensitive substring in one combined message', () => {
    const combined =
      `phase=upload ${SERVICE_ACCOUNT} key=${AKIA_KEY} ` +
      `access=${YA29_TOKEN} refresh=${REFRESH_TOKEN} text=${DEVANAGARI_RUN}`;
    const out = scrubError(combined);
    for (const secret of [SERVICE_ACCOUNT, AKIA_KEY, YA29_TOKEN, REFRESH_TOKEN, DEVANAGARI_RUN]) {
      expect(out, `leaked: ${secret}`).not.toContain(secret);
    }
    expect(out).toContain('[redacted]');
  });

  it('accepts an Error object (uses stack/message)', () => {
    const out = scrubError(new Error(`token=${YA29_TOKEN}`));
    expect(out).not.toContain(YA29_TOKEN);
    expect(out).toContain('[redacted]');
  });

  it('leaves benign text intact', () => {
    const out = scrubError('render failed: ffmpeg exited 1');
    expect(out).toContain('ffmpeg exited 1');
    expect(out).not.toContain('[redacted]');
  });
});
