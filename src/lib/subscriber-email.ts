import { confirmEmail } from '../../pipeline/email/templates/confirm-email';

export type SubscriberEmailEnv = {
  SUBSCRIBER_EMAIL_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
};

const DEV_KEY = new Uint8Array(32);

function encodeBase64Url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function emailKey(value: string | undefined, requireConfigured: boolean): Uint8Array {
  if (!value) {
    if (requireConfigured)
      throw new Error('Server misconfigured: SUBSCRIBER_EMAIL_KEY is unavailable.');
    return DEV_KEY;
  }
  const decoded = decodeBase64Url(value);
  if (decoded.length !== 32)
    throw new Error('SUBSCRIBER_EMAIL_KEY must decode to exactly 32 bytes.');
  return decoded;
}

export async function encryptSubscriberEmail(
  email: string,
  keyValue: string | undefined,
  requireConfigured: boolean,
): Promise<{ ciphertext: string; nonce: string }> {
  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(emailKey(keyValue, requireConfigured)),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(nonce) },
    key,
    new TextEncoder().encode(email.trim().toLowerCase()),
  );
  return {
    ciphertext: encodeBase64Url(new Uint8Array(encrypted)),
    nonce: encodeBase64Url(nonce),
  };
}

export async function decryptSubscriberEmail(
  ciphertext: string,
  nonce: string,
  keyValue: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    asArrayBuffer(emailKey(keyValue, true)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asArrayBuffer(decodeBase64Url(nonce)) },
    key,
    asArrayBuffer(decodeBase64Url(ciphertext)),
  );
  return new TextDecoder().decode(decrypted);
}

export function assertEmailDeliveryConfigured(
  env: SubscriberEmailEnv,
  requireConfigured: boolean,
): void {
  emailKey(env.SUBSCRIBER_EMAIL_KEY, requireConfigured);
  if (requireConfigured && (!env.RESEND_API_KEY || !env.RESEND_FROM)) {
    throw new Error('Server misconfigured: RESEND_API_KEY and RESEND_FROM are required.');
  }
}

export async function sendSubscriberConfirmation(args: {
  email: string;
  language: string;
  token: string;
  baseUrl: string;
  env: SubscriberEmailEnv;
  requireConfigured: boolean;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  if (!args.env.RESEND_API_KEY || !args.env.RESEND_FROM) return !args.requireConfigured;
  const payload = confirmEmail({
    lang: args.language,
    unsubscribeToken: args.token,
    baseUrl: args.baseUrl,
  });
  const response = await (args.fetchImpl ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: args.env.RESEND_FROM,
      to: [args.email],
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    }),
  });
  return response.ok;
}
