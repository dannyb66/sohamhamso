import { afterEach, describe, expect, it } from 'vitest';
import {
  type SubscriberConfirm,
  __setSubscriberConfirmForTests,
} from '../../src/lib/subscriber-confirm';
import {
  assertEmailDeliveryConfigured,
  decryptSubscriberEmail,
  encryptSubscriberEmail,
  sendSubscriberConfirmation,
} from '../../src/lib/subscriber-email';
import { GET as confirmGET } from '../../src/pages/api/confirm';
import { GET as unsubscribeGET } from '../../src/pages/api/unsubscribe';

const KEY = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE';

afterEach(() => {
  __setSubscriberConfirmForTests(null);
});

describe('subscriber email protection', () => {
  it('round-trips a normalized address through AES-GCM without storing plaintext', async () => {
    const encrypted = await encryptSubscriberEmail(' Person@Example.COM ', KEY, true);

    expect(encrypted.ciphertext).not.toContain('example');
    expect(encrypted.nonce).toHaveLength(16);
    await expect(decryptSubscriberEmail(encrypted.ciphertext, encrypted.nonce, KEY)).resolves.toBe(
      'person@example.com',
    );
  });

  it('rejects missing production delivery secrets', () => {
    expect(() => assertEmailDeliveryConfigured({}, true)).toThrow(/SUBSCRIBER_EMAIL_KEY/);
    expect(() => assertEmailDeliveryConfigured({ SUBSCRIBER_EMAIL_KEY: KEY }, true)).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it('sends the existing confirmation template through Resend', async () => {
    let captured: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      captured = init;
      return new Response('{"id":"email_1"}', { status: 200 });
    };
    const sent = await sendSubscriberConfirmation({
      email: 'person@example.com',
      language: 'en',
      token: 'A'.repeat(32),
      baseUrl: 'https://sohamhamso.org',
      env: {
        RESEND_API_KEY: 'test-key',
        RESEND_FROM: 'sohamhamso <daily@sohamhamso.org>',
      },
      requireConfigured: true,
      fetchImpl,
    });

    expect(sent).toBe(true);
    const body = JSON.parse(String(captured?.body)) as { to: string[]; html: string; text: string };
    expect(body.to).toEqual(['person@example.com']);
    expect(body.html).toContain('/api/confirm?token=');
    expect(body.text).toContain('/api/unsubscribe?token=');
  });

  it('makes the links in the real confirmation payload actionable', async () => {
    const token = 'Z'.repeat(32);
    const state = { confirmed: false, deleted: false };
    const fake: SubscriberConfirm = {
      async confirmByToken(value) {
        if (value !== token) return { status: 'unknown' };
        state.confirmed = true;
        return { status: 'confirmed' };
      },
      async deleteByToken(value) {
        if (value !== token) return { deleted: false };
        state.deleted = true;
        return { deleted: true };
      },
    };
    __setSubscriberConfirmForTests(fake);

    let captured: RequestInit | undefined;
    const sent = await sendSubscriberConfirmation({
      email: 'person@example.com',
      language: 'en',
      token,
      baseUrl: 'https://sohamhamso.org',
      env: { RESEND_API_KEY: 'test-key', RESEND_FROM: 'from@example.com' },
      requireConfigured: true,
      fetchImpl: async (_input, init) => {
        captured = init;
        return new Response('{"id":"email_1"}', { status: 200 });
      },
    });
    expect(sent).toBe(true);
    const payload = JSON.parse(String(captured?.body)) as { text: string };
    const confirmUrl = payload.text.match(
      /https:\/\/sohamhamso\.org\/api\/confirm\?token=[A-Za-z0-9_-]{32}/,
    )?.[0];
    const unsubscribeUrl = payload.text.match(
      /https:\/\/sohamhamso\.org\/api\/unsubscribe\?token=[A-Za-z0-9_-]{32}/,
    )?.[0];
    expect(confirmUrl).toBeDefined();
    expect(unsubscribeUrl).toBeDefined();

    const context = (url: string) =>
      ({ url: new URL(url), request: new Request(url) }) as unknown as Parameters<
        typeof confirmGET
      >[0];
    const confirmed = await confirmGET(context(confirmUrl as string));
    expect(confirmed.headers.get('location')).toBe('/confirmed');
    expect(state.confirmed).toBe(true);

    const unsubscribed = await unsubscribeGET(context(unsubscribeUrl as string));
    expect(unsubscribed.headers.get('location')).toBe('/unsubscribed');
    expect(state.deleted).toBe(true);
  });
});
